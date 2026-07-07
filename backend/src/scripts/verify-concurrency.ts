/**
 * Empirical concurrency check for the shared primitives in common/db-concurrency.ts.
 * Unit tests mock the repositories, so they cannot prove the LOCKING behaviour — this
 * script drives real parallel connections against the configured Postgres and asserts:
 *   1. transitionStatus is exactly-once under N concurrent callers.
 *   2. advisoryXactLock serialises a read-modify-write so no increment is lost.
 *
 * Run with: npx ts-node -r tsconfig-paths/register src/scripts/verify-concurrency.ts
 * It creates and drops a temporary table; it does not touch application tables.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import {
    transitionStatus,
    advisoryXactLock,
    AdvisoryLock,
} from '../common/db-concurrency';

async function main() {
    const ds = new DataSource({
        type: 'postgres',
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 5432),
        database: process.env.DB_DATABASE || 'foodies',
        username: process.env.DB_USERNAME || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
        // Enough pooled connections for the parallel callers below.
        extra: { max: 30 },
    });
    await ds.initialize();

    let failures = 0;
    const check = (name: string, ok: boolean, extra = '') => {
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
        if (!ok) failures++;
    };

    await ds.query(`DROP TABLE IF EXISTS _concurrency_probe`);
    await ds.query(`
        CREATE TABLE _concurrency_probe (
            id int primary key,
            status varchar not null,
            counter int not null default 0,
            updated_at timestamptz not null default now()
        )`);

    // ---- Test 1: transitionStatus is exactly-once ----
    await ds.query(
        `INSERT INTO _concurrency_probe (id, status) VALUES (1, 'ready')`,
    );
    const N = 25;
    const results = await Promise.all(
        Array.from({ length: N }, () =>
            transitionStatus(ds, '_concurrency_probe', 1, 'completed', {
                allowedFrom: ['ready'],
            }).catch(() => 'ERR' as const),
        ),
    );
    const winners = results.filter((r) => r === 'ready').length;
    const noops = results.filter((r) => r === null).length;
    const errs = results.filter((r) => r === 'ERR').length;
    check(
        'transitionStatus: exactly one of N concurrent callers transitions',
        winners === 1 && noops === N - 1 && errs === 0,
        `winners=${winners} noops=${noops} errs=${errs}`,
    );

    // ---- Test 2: advisoryXactLock prevents lost updates on a read-modify-write ----
    await ds.query(`UPDATE _concurrency_probe SET counter = 0 WHERE id = 1`);
    const M = 50;
    await Promise.all(
        Array.from({ length: M }, () =>
            ds.transaction(async (manager) => {
                // Deliberately read-modify-write (the anti-pattern) but serialised by
                // the advisory lock, so every increment must survive.
                await advisoryXactLock(manager, AdvisoryLock.ORDER_INVENTORY, 1);
                const rows = await manager.query(
                    `SELECT counter FROM _concurrency_probe WHERE id = 1`,
                );
                const cur = Number(rows[0].counter);
                await manager.query(
                    `UPDATE _concurrency_probe SET counter = $1 WHERE id = 1`,
                    [cur + 1],
                );
            }),
        ),
    );
    const finalRows = await ds.query(
        `SELECT counter FROM _concurrency_probe WHERE id = 1`,
    );
    const finalCounter = Number(finalRows[0].counter);
    check(
        'advisoryXactLock: no lost update across M serialised increments',
        finalCounter === M,
        `counter=${finalCounter} expected=${M}`,
    );

    await ds.query(`DROP TABLE IF EXISTS _concurrency_probe`);
    await ds.destroy();

    console.log(
        failures === 0
            ? '\nAll concurrency checks passed.'
            : `\n${failures} concurrency check(s) FAILED.`,
    );
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});

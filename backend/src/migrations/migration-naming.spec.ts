import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Guards the migration filename convention, because the failure it prevents is
 * invisible until it is expensive.
 *
 * TypeORM orders pending migrations by timestamp. When two share one, the order
 * between them falls back to whatever the file glob returned, which is
 * filesystem-dependent — so dev can apply A→B while production applies B→A, and
 * `migration:revert` has no defined answer for which one is "last". Today's two
 * duplicate pairs (…091, …092) happen to touch unrelated tables, which is the
 * only reason nothing has broken.
 *
 * ⚠️ The existing duplicates are deliberately NOT renamed. The `migrations`
 * table matches on (timestamp, name); renaming an already-applied migration
 * makes TypeORM treat it as pending and re-run it against production. They are
 * grandfathered below. New migrations must be unique.
 */
const GRANDFATHERED_DUPLICATES = new Set(['1760000000091', '1760000000092']);

const MIGRATIONS_DIR = __dirname;
const FILENAME = /^(\d{13})-([A-Za-z0-9]+)\.ts$/;

function migrationFiles(): string[] {
    return readdirSync(MIGRATIONS_DIR).filter(
        (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'),
    );
}

describe('migration naming', () => {
    const files = migrationFiles();

    it('finds migrations to check', () => {
        expect(files.length).toBeGreaterThan(0);
    });

    it('every filename is <13-digit timestamp>-<PascalCaseName>.ts', () => {
        const bad = files.filter((f) => !FILENAME.test(f));
        expect(bad).toEqual([]);
    });

    it('no two migrations share a timestamp', () => {
        const byTimestamp = new Map<string, string[]>();
        for (const file of files) {
            const match = FILENAME.exec(file);
            if (!match) continue;
            const [, timestamp] = match;
            byTimestamp.set(timestamp, [
                ...(byTimestamp.get(timestamp) ?? []),
                file,
            ]);
        }

        const duplicates = [...byTimestamp.entries()]
            .filter(([timestamp, group]) => {
                if (group.length < 2) return false;
                return !GRANDFATHERED_DUPLICATES.has(timestamp);
            })
            .map(([timestamp, group]) => `${timestamp}: ${group.join(', ')}`);

        expect(duplicates).toEqual([]);
    });

    it('grandfathered duplicates are still exactly the known pairs', () => {
        // If one of these is ever cleaned up properly (new environment, no
        // applied history), drop it from the set rather than leaving a stale
        // exemption that would hide a fresh collision on the same number.
        const counts = new Map<string, number>();
        for (const file of files) {
            const match = FILENAME.exec(file);
            if (!match) continue;
            counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
        }
        for (const timestamp of GRANDFATHERED_DUPLICATES) {
            expect(counts.get(timestamp)).toBe(2);
        }
    });

    it('the class name ends with its own timestamp', () => {
        // TypeORM derives ordering from the class-name suffix, not the
        // filename. A mismatch means the file sorts one way and the runner
        // another — the same tie-break hazard, harder to spot.
        const mismatched: string[] = [];
        for (const file of files) {
            const match = FILENAME.exec(file);
            if (!match) continue;
            const [, timestamp] = match;
            const source = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
            const cls = /export class (\w+)/.exec(source);
            if (!cls) {
                mismatched.push(`${file}: no exported class`);
                continue;
            }
            if (!cls[1].endsWith(timestamp)) {
                mismatched.push(`${file}: class ${cls[1]}`);
            }
        }
        expect(mismatched).toEqual([]);
    });
});

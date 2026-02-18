/**
 * Drop database, recreate it, run migrations, then seed.
 * Usage: npm run db:reset
 * Requires .env with DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_DATABASE.
 * Requires psql (PostgreSQL client) on PATH.
 */
import { config as dotenvConfig } from 'dotenv';
import { join } from 'path';
import { execFileSync, execSync } from 'child_process';

dotenvConfig({ path: join(process.cwd(), '.env') });

const dbName = process.env.DB_DATABASE ?? 'foodies';
const host = process.env.DB_HOST ?? '127.0.0.1';
const port = process.env.DB_PORT ?? '5432';
const user = process.env.DB_USERNAME ?? 'postgres';
const password = String(process.env.DB_PASSWORD ?? '');

function main() {
    const psqlEnv = { ...process.env, PGPASSWORD: password };

    execFileSync(
        'psql',
        [
            '-h',
            host,
            '-p',
            port,
            '-U',
            user,
            '-d',
            'postgres',
            '-c',
            `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${dbName}' AND pid <> pg_backend_pid();`,
            '-c',
            `DROP DATABASE IF EXISTS "${dbName}";`,
            '-c',
            `CREATE DATABASE "${dbName}";`,
        ],
        { env: psqlEnv, stdio: 'inherit' },
    );
    console.log(`Database "${dbName}" dropped and recreated.`);

    const backendDir = join(__dirname, '..', '..');
    execSync('npm run migration:run', { cwd: backendDir, stdio: 'inherit' });
    execSync('npm run seed', { cwd: backendDir, stdio: 'inherit' });
    console.log('Database reset complete. Migrations run and seed applied.');
}

try {
    main();
} catch (e) {
    console.error(e);
    process.exit(1);
}

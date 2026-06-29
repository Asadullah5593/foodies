/**
 * Standalone TypeORM DataSource for CLI (migration:run, migration:revert).
 * NestJS app uses TypeOrmModule in app.module.ts; this file is for TypeORM CLI only.
 * Uses process.cwd() so it works when run as compiled dist/data-source.js from backend dir.
 */
import { DataSource } from 'typeorm';
import { join } from 'path';
import { config as dotenvConfig } from 'dotenv';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';

const rootDir = process.cwd();

// Load .env when running via CLI (Nest loads it via ConfigModule)
dotenvConfig({ path: join(rootDir, '.env') });

export default new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_DATABASE || 'foodies',
    namingStrategy: new SnakeNamingStrategy(),
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    synchronize: false,
    migrations: [join(rootDir, 'dist', 'migrations', '*.js')],
    entities: [join(rootDir, 'dist', '**', '*.entity.js')],
});

/**
 * Standalone TypeORM DataSource for CLI (migration:run, migration:revert).
 * NestJS app uses TypeOrmModule in app.module.ts; this file is for TypeORM CLI only.
 */
import { DataSource } from 'typeorm';
import { join } from 'path';
import { config as dotenvConfig } from 'dotenv';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';

// Load .env when running via CLI (Nest loads it via ConfigModule)
dotenvConfig({ path: join(__dirname, '..', '.env') });

export default new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_DATABASE || 'foodies',
    namingStrategy: new SnakeNamingStrategy(),
    synchronize: false,
    migrations: [join(__dirname, 'migrations', '*.js')],
    entities: [join(__dirname, '**', '*.entity.js')],
});

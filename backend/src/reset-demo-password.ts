/**
 * Reset the demo user (owner@demo.com) password to owner123.
 * Run when login fails due to mismatched/old hash: npm run seed:reset-password
 */
import { config as dotenvConfig } from 'dotenv';
import { join } from 'path';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { User } from './entities/user.entity';

dotenvConfig({ path: join(process.cwd(), '.env') });

const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USERNAME ?? 'postgres',
    password: String(process.env.DB_PASSWORD ?? ''),
    database: process.env.DB_DATABASE ?? 'foodies',
    namingStrategy: new SnakeNamingStrategy(),
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    synchronize: false,
    entities: [join(__dirname, '**', '*.entity{.ts,.js}')],
});

async function reset() {
    await dataSource.initialize();
    const userRepo = dataSource.getRepository(User);
    const user = await userRepo.findOne({ where: { email: 'owner@demo.com' } });
    if (!user) {
        console.log('User owner@demo.com not found. Run npm run seed first.');
        await dataSource.destroy();
        process.exit(1);
    }
    const hashed = await bcrypt.hash('owner123', 10);
    // Update via raw query so the exact hash is written to the password column
    await dataSource.query('UPDATE users SET password = $1 WHERE id = $2', [
        hashed,
        user.id,
    ]);
    console.log(
        'Password reset for owner@demo.com. You can log in with owner123.',
    );
    await dataSource.destroy();
}

reset().catch((e) => {
    console.error(e);
    process.exit(1);
});

import { CustomersService } from './customers.service';
import { CustomersController } from './customers.controller';
import { withoutSecrets } from './customer-secrets';

/**
 * A customer's `password` is the bcrypt hash of their mobile-app / website
 * login. The admin API used to send it to every account that can list
 * customers — every cashier, since the POS customer picker loads that list.
 *
 * Nothing in the admin reads it, so it must never leave the server: not from
 * the list, not from a single record, and not from the responses to adding,
 * linking or renaming a customer.
 */
const HASH = '$2a$10$abcdefghijklmnopqrstuuJ8e1x9l0mB4kq0S9nHhYx1o2p3q4r5s';

const row = (over: Record<string, unknown> = {}) => ({
    id: 412,
    tenantId: 6,
    name: 'Abdullah Arshad',
    phone: '03240201350',
    email: 'abd@mail.com',
    password: HASH,
    source: 'consumer_app',
    phoneVerified: true,
    brandIds: null,
    createdAt: new Date('2026-06-12T00:00:00Z'),
    ...over,
});

const leaks = (payload: unknown) =>
    JSON.stringify(payload).includes(HASH) ||
    JSON.stringify(payload).includes('"password"');

describe('withoutSecrets', () => {
    it('drops the password hash and keeps everything else', () => {
        const safe = withoutSecrets(row());
        expect(safe).not.toHaveProperty('password');
        expect(safe).toMatchObject({
            id: 412,
            name: 'Abdullah Arshad',
            phone: '03240201350',
            email: 'abd@mail.com',
            source: 'consumer_app',
        });
    });

    it('does not touch the row it was given', () => {
        const original = row();
        withoutSecrets(original);
        // The service still needs the hash on the entity it loaded (login,
        // password change) — only the copy that is sent out loses it.
        expect(original.password).toBe(HASH);
    });

    it('is harmless on a row that has no password', () => {
        expect(withoutSecrets({ id: 1, name: 'A' })).toEqual({
            id: 1,
            name: 'A',
        });
    });

    it('drops the key even when the customer never set a password', () => {
        // `password: null` still tells the caller who has an app login.
        expect(withoutSecrets(row({ password: null }))).not.toHaveProperty(
            'password',
        );
    });
});

describe('CustomersService.findAll — the customer list', () => {
    const makeSvc = (customers: Array<Record<string, unknown>>) => {
        const svc = Object.create(
            CustomersService.prototype,
        ) as unknown as CustomersService;
        const qb: Record<string, unknown> = {};
        for (const m of ['where', 'orderBy', 'andWhere']) qb[m] = () => qb;
        qb.getMany = () => Promise.resolve(customers);
        Object.assign(svc, {
            repo: {
                find: () => Promise.resolve(customers),
                createQueryBuilder: () => qb,
            },
            dataSource: { query: () => Promise.resolve([]) },
        });
        return svc;
    };

    it('sends no password hash to an owner', async () => {
        const list = await makeSvc([
            row(),
            row({ id: 7, password: null }),
        ]).findAll(6, null);
        expect(list).toHaveLength(2);
        expect(leaks(list)).toBe(false);
    });

    it('sends no password hash to a brand-locked account', async () => {
        const list = await makeSvc([row()]).findAll(6, [23]);
        expect(list).toHaveLength(1);
        expect(leaks(list)).toBe(false);
    });

    it('still sends what the admin pages read', async () => {
        const [c] = (await makeSvc([row()]).findAll(6, null)) as Array<
            Record<string, unknown>
        >;
        expect(c).toMatchObject({
            id: 412,
            name: 'Abdullah Arshad',
            phone: '03240201350',
            email: 'abd@mail.com',
            source: 'consumer_app',
        });
        expect(c.createdAt).toBeInstanceOf(Date);
        expect(c).toHaveProperty('brands');
        expect(c).toHaveProperty('branches');
        expect(c).toHaveProperty('orderStats');
        expect(c).toHaveProperty('loyaltyWallets');
    });
});

describe('CustomersController — every response that carries a customer', () => {
    const viewer = {
        id: 1,
        tenantId: 6,
        allowedBrandIds: null,
        permissions: ['customers:view'],
    };
    const make = (service: Record<string, unknown>) => {
        const controller = Object.create(
            CustomersController.prototype,
        ) as unknown as CustomersController;
        Object.assign(controller, { service });
        return controller;
    };

    it('a single customer', async () => {
        const controller = make({ findOne: () => Promise.resolve(row()) });
        const out = await controller.show('412', viewer);
        expect(leaks(out)).toBe(false);
        expect(out).toMatchObject({ id: 412, phone: '03240201350' });
    });

    it('adding a customer', async () => {
        const controller = make({ create: () => Promise.resolve(row()) });
        const out = await controller.store(viewer, {
            phone: '03240201350',
            name: 'Abdullah Arshad',
        });
        expect(leaks(out)).toBe(false);
    });

    it('linking an existing customer — who may already have an app login', async () => {
        const controller = make({
            create: () => Promise.resolve({ ...row(), linked: true }),
        });
        const out = await controller.store(viewer, {
            phone: '03240201350',
            name: 'Abdullah Arshad',
            link: true,
        });
        expect(leaks(out)).toBe(false);
        // The page still needs to know it was a link, not a new record.
        expect(out).toMatchObject({ id: 412, linked: true });
    });

    it('renaming a customer', async () => {
        const controller = make({
            update: () => Promise.resolve(row({ name: 'Abdullah A.' })),
        });
        const out = await controller.update('412', viewer, {
            name: 'Abdullah A.',
        });
        expect(leaks(out)).toBe(false);
        expect(out).toMatchObject({ name: 'Abdullah A.' });
    });
});

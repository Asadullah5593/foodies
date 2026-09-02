import { DataSource } from 'typeorm';
import { CustomerAddressesService } from './customer-addresses.service';

const svc = (query = jest.fn().mockResolvedValue([])) => ({
    service: new CustomerAddressesService({ query } as unknown as DataSource),
    query,
});

const order = (over: Record<string, unknown> = {}) => ({
    tenantId: 6,
    brandId: 25,
    customerId: null,
    customerPhone: '03001112233',
    address: 'House 5, Street 2',
    latitude: 31.47,
    longitude: 74.39,
    ...over,
});

describe('rememberFromOrder — must never cost a customer their order', () => {
    it('records a delivery that resolved to a point', async () => {
        const { service, query } = svc();
        await service.rememberFromOrder(order());
        expect(query).toHaveBeenCalledTimes(1);
        const [, params] = query.mock.calls[0] as [string, unknown[]];
        // The key is the normalised form, not the typed text.
        expect(params).toContain('house 5 street 2');
    });

    it('swallows a database failure instead of throwing into order placement', async () => {
        const query = jest.fn().mockRejectedValue(new Error('deadlock'));
        const { service } = svc(query);
        await expect(
            service.rememberFromOrder(order()),
        ).resolves.toBeUndefined();
    });

    it.each([
        ['no phone', { customerPhone: null }],
        ['blank phone', { customerPhone: '   ' }],
        ['no address', { address: null }],
        ['blank address', { address: '  ' }],
        ['address that normalises to nothing', { address: '...' }],
        ['no latitude', { latitude: null }],
        ['no longitude', { longitude: null }],
    ])('writes nothing when there is %s', async (_label, over) => {
        const { service, query } = svc();
        await service.rememberFromOrder(order(over));
        expect(query).not.toHaveBeenCalled();
    });

    it('skips an address with no coordinates — the POS could never pick it', async () => {
        // A delivery order cannot be placed without a point (the fee is priced
        // by distance and the rider needs a pin), so offering one would only
        // ever produce an order that fails validation.
        const { service, query } = svc();
        await service.rememberFromOrder(
            order({ latitude: null, longitude: null }),
        );
        expect(query).not.toHaveBeenCalled();
    });
});

describe('listForPhone — who sees which addresses', () => {
    it('does not filter by brand for an unrestricted user', async () => {
        const { service, query } = svc();
        await service.listForPhone(6, '03001112233', null);
        const [sql] = query.mock.calls[0] as [string];
        expect(sql).not.toContain('brand_ids &&');
    });

    it('filters to the caller’s own brands when brand-locked', async () => {
        const { service, query } = svc();
        await service.listForPhone(6, '03001112233', [23]);
        const [sql, params] = query.mock.calls[0] as [string, unknown[]];
        expect(sql).toContain('brand_ids &&');
        expect(params).toContainEqual([23]);
    });

    it('returns nothing for a user locked to no brand at all, without querying', async () => {
        const { service, query } = svc();
        await expect(
            service.listForPhone(6, '03001112233', []),
        ).resolves.toEqual([]);
        expect(query).not.toHaveBeenCalled();
    });

    it('only ever offers addresses that carry a point', async () => {
        const { service, query } = svc();
        await service.listForPhone(6, '03001112233', null);
        const [sql] = query.mock.calls[0] as [string];
        expect(sql).toContain('latitude IS NOT NULL');
        expect(sql).toContain('longitude IS NOT NULL');
    });

    it('never offers an address that has been hidden', async () => {
        const { service, query } = svc();
        await service.listForPhone(6, '03001112233', null);
        const [sql] = query.mock.calls[0] as [string];
        expect(sql).toContain('deleted_at IS NULL');
    });

    it('is scoped to the tenant', async () => {
        const { service, query } = svc();
        await service.listForPhone(6, '03001112233', null);
        const [sql, params] = query.mock.calls[0] as [string, unknown[]];
        expect(sql).toContain('ca.tenant_id = $1');
        expect(params[0]).toBe(6);
    });

    it('shapes rows for the till, coercing the numeric columns', async () => {
        const { service } = svc(
            jest.fn().mockResolvedValue([
                {
                    id: '7',
                    label: null,
                    address: 'House 5, Street 2',
                    latitude: '31.4700000',
                    longitude: '74.3900000',
                    notes: null,
                    times_used: '3',
                    last_used_at: new Date('2026-08-27T10:00:00Z'),
                },
            ]),
        );
        const [row] = await service.listForPhone(6, '03001112233', null);
        expect(row).toEqual({
            id: 7,
            label: null,
            address: 'House 5, Street 2',
            latitude: 31.47,
            longitude: 74.39,
            notes: null,
            times_used: 3,
            last_used_at: '2026-08-27T10:00:00.000Z',
        });
    });
});

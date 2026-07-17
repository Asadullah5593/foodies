import { OrdersService } from './orders.service';

/**
 * The rider order payload (GET /rider/orders/:id and the response of
 * PATCH /rider/orders/:id/status, which returns the same thing) carries the
 * assigned rider alongside the order.
 */
describe('OrdersService.findForRider — rider details', () => {
    const ORDER = {
        id: 100,
        orderNumber: '014',
        orderGroupId: null,
        status: 'preparing',
        deliveryStatus: 'picked_up',
        deliveryFailedReason: null,
        customerName: 'John Doe',
        customerPhone: '03001112222',
        deliveryAddress: '12 Main St',
        deliveryLatitude: '31.5',
        deliveryLongitude: '74.3',
        branchLatitude: '31.4',
        branchLongitude: '74.2',
        placedAt: new Date('2026-07-17T09:00:00.000Z'),
        totalAmount: '1299.00',
        riderId: 42,
        rider: { id: 42, name: 'Bilal', phone: '03009998877' },
        branch: {
            id: 10,
            name: 'Emporium',
            address: 'Mall Rd',
            latitude: '31.4',
            longitude: '74.2',
        },
        brand: { name: 'Fireaway' },
        orderItems: [
            {
                id: 5,
                nameSnapshot: 'Pizza',
                menuItem: { name: 'Pizza' },
                quantity: 2,
                notes: null,
                unitPrice: '649.50',
                addons: [{ addon: { name: 'Extra cheese' }, quantity: 1 }],
            },
        ],
    };

    const build = (order: unknown) => {
        const findOne = jest.fn(() => Promise.resolve(order));
        // findForRider only touches orderRepo; skip the 18-dep constructor.
        const service = Object.create(OrdersService.prototype) as OrdersService;
        (service as unknown as { orderRepo: unknown }).orderRepo = { findOne };
        return { service, findOne };
    };

    it('returns the assigned rider with id, name and phone', async () => {
        const { service } = build(ORDER);
        const payload = await service.findForRider(100, 42);
        expect(payload.rider).toEqual({
            id: 42,
            name: 'Bilal',
            phone: '03009998877',
        });
    });

    it('loads the rider relation so the block is never silently empty', async () => {
        const { service, findOne } = build(ORDER);
        await service.findForRider(100, 42);
        const args = findOne.mock.calls[0][0] as unknown as {
            relations: string[];
            where: Record<string, unknown>;
        };
        expect(args.relations).toContain('rider');
        // Still scoped to the calling rider — the rider block cannot leak someone else's order.
        expect(args.where).toEqual({ id: 100, riderId: 42 });
    });

    it('reports a rider with no phone as null rather than dropping the block', async () => {
        const { service } = build({
            ...ORDER,
            rider: { id: 42, name: 'Bilal', phone: null },
        });
        const payload = await service.findForRider(100, 42);
        expect(payload.rider).toEqual({ id: 42, name: 'Bilal', phone: null });
    });

    it('keeps every field the payload carried before', async () => {
        const { service } = build(ORDER);
        const payload = await service.findForRider(100, 42);
        expect(payload).toMatchObject({
            id: 100,
            order_number: '014',
            order_group_id: null,
            status: 'preparing',
            delivery_status: 'picked_up',
            delivery_failed_reason: null,
            customer_name: 'John Doe',
            customer_phone: '03001112222',
            delivery_address: '12 Main St',
            delivery_latitude: 31.5,
            delivery_longitude: 74.3,
            branch_latitude: 31.4,
            branch_longitude: 74.2,
            placed_at: '2026-07-17T09:00:00.000Z',
            total_amount: 1299,
            brand_name: 'Fireaway',
            branch: {
                id: 10,
                name: 'Emporium',
                address: 'Mall Rd',
                latitude: 31.4,
                longitude: 74.2,
            },
            items: [
                {
                    id: 5,
                    name_snapshot: 'Pizza',
                    quantity: 2,
                    notes: null,
                    unit_price: 649.5,
                    addons: [{ name: 'Extra cheese', quantity: 1 }],
                },
            ],
        });
    });
});

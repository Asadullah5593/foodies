import { BadRequestException } from '@nestjs/common';
import { OrdersService } from './orders.service';

/**
 * A delivery marked completed before anyone was assigned still has no rider on
 * record. Two rules follow, and both are pinned here:
 *
 * 1. It shows under "Needs rider" — in the list and in the tile's count.
 * 2. A rider can be attached to it.
 *
 * What must NOT follow: a cancelled order taking a rider (a rider marking it
 * delivered would move it to completed and book its cash and loyalty points),
 * or a completed order that already has a rider being handed to another.
 */
describe('OrdersService — deliveries with no rider', () => {
    /** A query builder that records what it was asked and answers with nothing. */
    const recordingQb = () => {
        const wheres: Array<{ sql: string; params?: Record<string, unknown> }> =
            [];
        const qb: Record<string, unknown> = {};
        for (const method of [
            'leftJoinAndSelect',
            'select',
            'addSelect',
            'orderBy',
            'skip',
            'take',
            'groupBy',
        ]) {
            qb[method] = () => qb;
        }
        qb.andWhere = (sql: string, params?: Record<string, unknown>) => {
            wheres.push({ sql, params });
            return qb;
        };
        qb.getManyAndCount = () => Promise.resolve([[], 0]);
        qb.getRawMany = () => Promise.resolve([]);
        qb.getRawOne = () => Promise.resolve({ count: '0' });
        return { qb, wheres };
    };

    describe('the "Needs rider" view', () => {
        const run = async (status?: string) => {
            const builders: Array<ReturnType<typeof recordingQb>> = [];
            const svc = Object.create(
                OrdersService.prototype,
            ) as unknown as OrdersService;
            Object.assign(svc, {
                orderRepo: {
                    createQueryBuilder: () => {
                        const b = recordingQb();
                        builders.push(b);
                        return b.qb;
                    },
                },
            });
            await svc.findAllAdmin(6, { status });
            // In the order findAllAdmin builds them.
            const [data, , needsRiderCount] = builders;
            const needsRider = (b: ReturnType<typeof recordingQb>) =>
                b.wheres.find((w) => w.params && 'nrs' in w.params);
            return {
                list: needsRider(data),
                count: needsRider(needsRiderCount),
                listWheres: data.wheres,
            };
        };

        it('lists a completed delivery that has no rider', async () => {
            const { list } = await run('needs_rider');
            expect(list?.params?.nrs).toEqual([
                'placed',
                'accepted',
                'preparing',
                'ready',
                'completed',
            ]);
        });

        it('never lists a cancelled one — it needs no one', async () => {
            const { list, count } = await run('needs_rider');
            expect(list?.params?.nrs).not.toContain('cancelled');
            expect(count?.params?.nrs).not.toContain('cancelled');
        });

        it('still means a delivery order with nobody on it', async () => {
            const { list } = await run('needs_rider');
            expect(list?.sql).toContain("o.orderType = 'delivery'");
            expect(list?.sql).toContain('o.riderId IS NULL');
        });

        it('counts the tile by the same rule as the list', async () => {
            const { list, count } = await run('needs_rider');
            expect(count?.sql).toBe(list?.sql);
            expect(count?.params?.nrs).toEqual(list?.params?.nrs);
        });

        it('leaves every other view alone', async () => {
            const completed = await run('completed');
            expect(completed.list).toBeUndefined();
            expect(
                completed.listWheres.some(
                    (w) =>
                        w.sql === 'o.status = :status' &&
                        w.params?.status === 'completed',
                ),
            ).toBe(true);
            // The tile still counts, whichever view is open.
            expect(completed.count?.params?.nrs).toContain('completed');

            const all = await run();
            expect(all.list).toBeUndefined();
        });
    });

    describe('attaching a rider', () => {
        const makeSvc = (opts: { status: string; affected: number }) => {
            const order = {
                id: 37,
                tenantId: 6,
                branchId: 10,
                brandId: 23,
                orderType: 'delivery',
                status: opts.status,
                riderId: null as number | null,
                deliveryStatus: null as string | null,
                orderNumber: '001',
                orderId: 'FDS-A7K2M9QX',
            };
            const update: {
                set?: Record<string, unknown>;
                where?: string;
                params?: Record<string, unknown>;
            } = {};
            const updateQb: Record<string, unknown> = {};
            updateQb.update = () => updateQb;
            updateQb.set = (values: Record<string, unknown>) => {
                update.set = values;
                return updateQb;
            };
            updateQb.where = (sql: string, params: Record<string, unknown>) => {
                update.where = sql;
                update.params = params;
                return updateQb;
            };
            updateQb.execute = () =>
                Promise.resolve({ affected: opts.affected });

            const manager = {
                query: jest.fn().mockResolvedValue([]),
                getRepository: () => ({ createQueryBuilder: () => updateQb }),
            };
            const ledger = jest.fn().mockResolvedValue(undefined);
            const notifyRider = jest.fn();
            const notifyCustomer = jest.fn();
            const svc = Object.create(
                OrdersService.prototype,
            ) as unknown as OrdersService;
            Object.assign(svc, {
                orderRepo: { findOne: jest.fn().mockResolvedValue(order) },
                dataSource: {
                    transaction: (fn: (m: unknown) => Promise<unknown>) =>
                        fn(manager),
                },
                pushNotificationService: {
                    notifyConsumerOrder: notifyCustomer,
                    notifyRiderNewAssignment: notifyRider,
                },
                listRiders: jest
                    .fn()
                    .mockResolvedValue([{ id: 9, name: 'rider ahmad' }]),
                assertOrderBrandAllowed: jest.fn(),
                assertRiderLinkedToBrand: jest
                    .fn()
                    .mockResolvedValue(undefined),
                resolveOrderTierCap: jest.fn().mockResolvedValue({
                    effectiveTier: 'standard',
                    maxBatchSize: 1,
                }),
                assertRiderEligibleForManualAssignment: jest
                    .fn()
                    .mockResolvedValue(undefined),
                createAssignmentLedgerEntry: ledger,
                findForAdmin: jest.fn().mockResolvedValue({ id: order.id }),
            });
            return { svc, update, ledger, notifyRider, notifyCustomer };
        };

        it('no longer refuses an order for being completed', async () => {
            const { svc, update } = makeSvc({
                status: 'completed',
                affected: 1,
            });
            await expect(svc.assignRider(37, 6, 9)).resolves.toEqual({
                id: 37,
            });
            // The rule that produced "This order can no longer be assigned".
            expect(update.where).not.toMatch(/NOT IN/i);
            expect(update.params).toEqual({ id: 37 });
        });

        it('lets a completed order take a rider only while it has none', () => {
            const { svc, update } = makeSvc({
                status: 'completed',
                affected: 1,
            });
            return svc.assignRider(37, 6, 9).then(() => {
                expect(update.where).toContain(
                    "(status <> 'completed' OR rider_id IS NULL)",
                );
            });
        });

        it('still refuses a cancelled order', async () => {
            const { svc, update } = makeSvc({
                status: 'completed',
                affected: 1,
            });
            await svc.assignRider(37, 6, 9);
            expect(update.where).toContain("status <> 'cancelled'");
        });

        it('assigns exactly as it does for any other order', async () => {
            const { svc, update, ledger, notifyRider, notifyCustomer } =
                makeSvc({ status: 'completed', affected: 1 });
            await svc.assignRider(37, 6, 9);
            expect(update.set).toEqual({
                riderId: 9,
                deliveryStatus: 'accepted',
                deliveryFailedReason: null,
                // A new assignment is a new trip (see trip-time.spec.ts).
                pickedUpAt: null,
                deliveredAt: null,
            });
            expect(ledger).toHaveBeenCalledWith(
                expect.objectContaining({
                    orderId: 37,
                    eventType: 'manual',
                    selectedRiderUserId: 9,
                }),
            );
            expect(notifyRider).toHaveBeenCalledTimes(1);
            expect(notifyCustomer).toHaveBeenCalledWith(
                expect.objectContaining({ id: 37 }),
                'rider_assigned',
            );
        });

        it('says why when the order cannot take a rider, and changes nothing else', async () => {
            const { svc, ledger, notifyRider, notifyCustomer } = makeSvc({
                status: 'cancelled',
                affected: 0,
            });
            await expect(svc.assignRider(37, 6, 9)).rejects.toThrow(
                BadRequestException,
            );
            await expect(svc.assignRider(37, 6, 9)).rejects.toThrow(
                /cancelled, or it is completed and already has a rider/,
            );
            expect(ledger).not.toHaveBeenCalled();
            expect(notifyRider).not.toHaveBeenCalled();
            expect(notifyCustomer).not.toHaveBeenCalled();
        });
    });
});

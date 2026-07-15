import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';

/**
 * Campaigns only ever filtered its LIST by brand — every write path took tenantId
 * alone, so a brand-locked admin could edit or delete another brand's campaign and
 * rewrite its eligibility to any brand. These lock the write paths down.
 */
describe('CampaignsService — brand scoping on writes', () => {
    const FIREAWAY = 25;
    const WOK = 28;

    function makeService(
        campaign?: Partial<{
            id: number;
            eligibilityBrandIds: number[] | null;
        }>,
    ) {
        const row = {
            id: 7,
            tenantId: 6,
            name: 'Ramadan',
            eligibilityBrandIds: null,
            ...campaign,
        };
        const campaignRepo = {
            findOne: jest.fn().mockResolvedValue(row),
            save: jest.fn(async (c: unknown) => c),
            remove: jest.fn().mockResolvedValue(undefined),
            create: jest.fn((c: unknown) => c),
            find: jest.fn().mockResolvedValue([row]),
        };
        const itemRepo = {
            count: jest.fn().mockResolvedValue(0),
            findOne: jest.fn().mockResolvedValue({ id: 3, campaignId: 7 }),
            remove: jest.fn().mockResolvedValue(undefined),
        };
        const brandRepo = {
            find: jest
                .fn()
                .mockResolvedValue([{ id: 23 }, { id: FIREAWAY }, { id: WOK }]),
        };
        const noop = {} as never;
        const service = new CampaignsService(
            campaignRepo as never,
            itemRepo as never,
            noop, // discountRepo
            noop, // realizationRepo
            brandRepo as never,
        );
        return { service, campaignRepo, itemRepo, row };
    }

    describe('update', () => {
        it("refuses to edit another brand's campaign", async () => {
            const { service } = makeService({ eligibilityBrandIds: [WOK] });
            await expect(
                service.update(7, 6, { name: 'hijacked' }, [FIREAWAY]),
            ).rejects.toBeInstanceOf(ForbiddenException);
        });

        it('refuses to edit an all-brand campaign (owner-managed)', async () => {
            const { service } = makeService({ eligibilityBrandIds: null });
            await expect(
                service.update(7, 6, { name: 'hijacked' }, [FIREAWAY]),
            ).rejects.toBeInstanceOf(ForbiddenException);
        });

        it('refuses to edit a campaign shared with another brand', async () => {
            const { service } = makeService({
                eligibilityBrandIds: [FIREAWAY, WOK],
            });
            await expect(
                service.update(7, 6, { name: 'hijacked' }, [FIREAWAY]),
            ).rejects.toBeInstanceOf(ForbiddenException);
        });

        it('allows editing their own brand-only campaign', async () => {
            const { service, campaignRepo } = makeService({
                eligibilityBrandIds: [FIREAWAY],
            });
            await service.update(7, 6, { name: 'Fireaway Friday' }, [FIREAWAY]);
            expect(campaignRepo.save).toHaveBeenCalled();
        });

        it('lets an unrestricted owner edit anything', async () => {
            const { service, campaignRepo } = makeService({
                eligibilityBrandIds: [WOK],
            });
            await service.update(7, 6, { name: 'Owner edit' }, null);
            expect(campaignRepo.save).toHaveBeenCalled();
        });

        it('refuses to widen eligibility beyond the caller brands', async () => {
            const { service } = makeService({
                eligibilityBrandIds: [FIREAWAY],
            });
            await expect(
                service.update(
                    7,
                    6,
                    { eligibility_brand_ids: [FIREAWAY, WOK] },
                    [FIREAWAY],
                ),
            ).rejects.toBeInstanceOf(ForbiddenException);
        });
    });

    describe('create', () => {
        it('stamps a brand-locked creator with their own brands', async () => {
            const { service, campaignRepo } = makeService();
            await service.create(6, { name: 'Mine' }, [FIREAWAY]);
            expect(campaignRepo.create).toHaveBeenCalledWith(
                expect.objectContaining({ eligibilityBrandIds: [FIREAWAY] }),
            );
        });

        it("refuses to create for someone else's brand", async () => {
            const { service } = makeService();
            await expect(
                service.create(6, { name: 'X', eligibility_brand_ids: [WOK] }, [
                    FIREAWAY,
                ]),
            ).rejects.toBeInstanceOf(ForbiddenException);
        });

        it('leaves an owner-created campaign unrestricted (all brands)', async () => {
            const { service, campaignRepo } = makeService();
            await service.create(6, { name: 'Everyone' }, null);
            expect(campaignRepo.create).toHaveBeenCalledWith(
                expect.objectContaining({ eligibilityBrandIds: null }),
            );
        });
    });

    describe('remove', () => {
        it('detaches instead of deleting when the campaign is all-brand', async () => {
            const { service, campaignRepo } = makeService({
                eligibilityBrandIds: null,
            });
            const res = await service.remove(7, 6, [FIREAWAY]);
            expect(campaignRepo.remove).not.toHaveBeenCalled();
            expect(res).toMatchObject({
                detached: true,
                eligibility_brand_ids: [23, WOK],
            });
        });

        it('detaches only the caller brand from a shared campaign', async () => {
            const { service, campaignRepo } = makeService({
                eligibilityBrandIds: [FIREAWAY, WOK],
            });
            const res = await service.remove(7, 6, [FIREAWAY]);
            expect(campaignRepo.remove).not.toHaveBeenCalled();
            expect(res).toMatchObject({
                detached: true,
                eligibility_brand_ids: [WOK],
            });
        });

        it('really deletes when the caller was the only brand', async () => {
            const { service, campaignRepo } = makeService({
                eligibilityBrandIds: [FIREAWAY],
            });
            await service.remove(7, 6, [FIREAWAY]);
            expect(campaignRepo.remove).toHaveBeenCalled();
        });

        it("refuses to delete another brand's campaign", async () => {
            const { service } = makeService({ eligibilityBrandIds: [WOK] });
            await expect(
                service.remove(7, 6, [FIREAWAY]),
            ).rejects.toBeInstanceOf(ForbiddenException);
        });
    });

    describe('items inherit the campaign brand scope', () => {
        it("refuses to delete an item on another brand's campaign", async () => {
            const { service } = makeService({ eligibilityBrandIds: [WOK] });
            await expect(
                service.removeItem(7, 3, 6, [FIREAWAY]),
            ).rejects.toBeInstanceOf(NotFoundException);
        });

        it("refuses to list items of another brand's campaign", async () => {
            const { service } = makeService({ eligibilityBrandIds: [WOK] });
            await expect(
                service.listItems(7, 6, [FIREAWAY]),
            ).rejects.toBeInstanceOf(NotFoundException);
        });

        it('allows item deletion on their own campaign', async () => {
            const { service, itemRepo } = makeService({
                eligibilityBrandIds: [FIREAWAY],
            });
            await service.removeItem(7, 3, 6, [FIREAWAY]);
            expect(itemRepo.remove).toHaveBeenCalled();
        });
    });
});

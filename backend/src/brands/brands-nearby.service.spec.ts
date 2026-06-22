import { BrandsService } from './brands.service';

/**
 * Unit coverage for findPublicNearbyRows: the brand×branch flattening used by the
 * consumer location-based endpoints (/public/consumer/nearby/*).
 */
describe('BrandsService.findPublicNearbyRows', () => {
    const makeService = () => {
        const repo = { find: jest.fn() } as any;
        const branchBrandRepo = {} as any;
        const ratingQb = {
            select: jest.fn().mockReturnThis(),
            addSelect: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            groupBy: jest.fn().mockReturnThis(),
            getRawMany: jest.fn().mockResolvedValue([]),
        };
        const brandRatingRepo = {
            createQueryBuilder: jest.fn().mockReturnValue(ratingQb),
        } as any;
        const service = new BrandsService(
            repo,
            branchBrandRepo,
            brandRatingRepo,
            {} as any,
        );
        return { service, repo };
    };

    const brand = (id: number, name: string, isActive = true) => ({
        id,
        name,
        slug: name.toLowerCase(),
        description: null,
        logoUrl: null,
        isActive,
        deliveryFlatFee: 0,
        tenantId: 1,
    });

    const branch = (
        id: number,
        name: string,
        branchBrands: Array<{ brandId: number; isOpen?: boolean }>,
    ) => ({ id, name, branchBrands }) as any;

    it('emits one row per (brand, branch) for a brand at multiple branches', async () => {
        const { service, repo } = makeService();
        repo.find.mockResolvedValue([brand(1, 'Peri')]);
        const nearby = [
            {
                branch: branch(10, 'Downtown', [{ brandId: 1, isOpen: true }]),
                distanceKm: 1.23,
            },
            {
                branch: branch(20, 'Uptown', [{ brandId: 1, isOpen: false }]),
                distanceKm: 2.67,
            },
        ];

        const rows = await service.findPublicNearbyRows(nearby);

        expect(rows).toHaveLength(2);
        // Sorted by distance ascending.
        expect(rows[0]).toMatchObject({
            id: 1,
            branch_id: 10,
            branch_name: 'Downtown',
            is_open: true,
            distance_km: 1.2,
        });
        expect(rows[1]).toMatchObject({
            id: 1,
            branch_id: 20,
            branch_name: 'Uptown',
            is_open: false,
            distance_km: 2.7,
        });
    });

    it('excludes inactive brands (not returned by the active-only query)', async () => {
        const { service, repo } = makeService();
        // repo.find filters isActive:true, so brand 2 never comes back.
        repo.find.mockResolvedValue([brand(1, 'Peri')]);
        const nearby = [
            {
                branch: branch(10, 'Downtown', [
                    { brandId: 1, isOpen: true },
                    { brandId: 2, isOpen: true },
                ]),
                distanceKm: 1,
            },
        ];

        const rows = await service.findPublicNearbyRows(nearby);

        expect(rows.map((r) => r.id)).toEqual([1]);
    });

    it('applies the brandId filter (category restriction)', async () => {
        const { service, repo } = makeService();
        repo.find.mockResolvedValue([brand(1, 'Peri'), brand(2, 'Wok')]);
        const nearby = [
            {
                branch: branch(10, 'Downtown', [
                    { brandId: 1, isOpen: true },
                    { brandId: 2, isOpen: true },
                ]),
                distanceKm: 1,
            },
        ];

        const rows = await service.findPublicNearbyRows(
            nearby,
            undefined,
            new Set([2]),
        );

        expect(rows.map((r) => r.id)).toEqual([2]);
    });

    it('filters by search (case-insensitive brand name)', async () => {
        const { service, repo } = makeService();
        repo.find.mockResolvedValue([brand(1, 'Peri'), brand(2, 'Wok')]);
        const nearby = [
            {
                branch: branch(10, 'Downtown', [
                    { brandId: 1, isOpen: true },
                    { brandId: 2, isOpen: true },
                ]),
                distanceKm: 1,
            },
        ];

        const rows = await service.findPublicNearbyRows(nearby, 'wo');

        expect(rows.map((r) => r.id)).toEqual([2]);
    });

    it('returns [] when no nearby branches carry brands', async () => {
        const { service, repo } = makeService();
        const rows = await service.findPublicNearbyRows([]);
        expect(rows).toEqual([]);
        expect(repo.find).not.toHaveBeenCalled();
    });
});

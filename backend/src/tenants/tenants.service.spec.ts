import {
    ActivityContext,
    type ActivityStore,
} from '../activity-log/activity-context';
import { diffSnapshots } from '../activity-log/activity-log.redaction';
import { TenantsService } from './tenants.service';

/**
 * Business Settings saves leave a before/after in the activity log, so "who
 * turned on GST on the menu price, and when" has an answer.
 */
describe('TenantsService — business settings audit', () => {
    const stored = () => ({
        id: 7,
        name: 'Foodies',
        slug: 'foodies',
        status: 'active',
        legalName: 'Foodies (Pvt) Ltd',
        defaultCurrency: 'PKR',
        defaultTimezone: 'UTC',
        // TypeORM hands decimals back as strings.
        gstRateCash: '16.00',
        gstRateCard: '8.00',
        taxOnMenuPrice: false,
        loyaltyEnabled: true,
        autoPrintInvoices: false,
        defaultServiceCharge: 0,
    });

    const makeService = () => {
        let row: Record<string, unknown> = stored();
        const repo = {
            findOne: jest.fn(() => Promise.resolve({ ...row })),
            save: jest.fn((t: Record<string, unknown>) => {
                row = { ...t };
                return Promise.resolve(t);
            }),
        };
        const service = new TenantsService(
            repo as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
        );
        return { service, repo };
    };

    const inRequest = async (fn: () => Promise<unknown>) => {
        const store: ActivityStore = { requestId: 'r1', changes: [] };
        await ActivityContext.run(store, fn);
        return store;
    };

    it('records only what the save changed, under the business it belongs to', async () => {
        const { service } = makeService();
        // The page sends the whole form; only the switch moved.
        const store = await inRequest(() =>
            service.updateBusinessSettings(7, {
                name: 'Foodies',
                legal_name: 'Foodies (Pvt) Ltd',
                gst_rate_cash: 16,
                gst_rate_card: 8,
                tax_on_menu_price: true,
                loyalty_enabled: true,
                auto_print_invoices: false,
            }),
        );

        expect(store.tenantId).toBe(7);
        expect(store.changes).toHaveLength(1);
        const [change] = store.changes;
        expect(change).toMatchObject({
            entityType: 'business_setting',
            entityId: 7,
            entityLabel: 'Foodies',
        });
        expect(diffSnapshots(change.before, change.after)).toMatchObject({
            changes: { tax_on_menu_price: { before: false, after: true } },
            changedFields: ['tax_on_menu_price'],
        });
    });

    it('records a rate change with the old and new rate', async () => {
        const { service } = makeService();
        const store = await inRequest(() =>
            service.updateBusinessSettings(7, { gst_rate_cash: 18 }),
        );
        const [change] = store.changes;
        expect(diffSnapshots(change.before, change.after).changes).toEqual({
            gst_rate_cash: { before: 16, after: 18 },
        });
    });

    it('still saves outside a request (seeds, scripts)', async () => {
        const { service, repo } = makeService();
        await service.updateBusinessSettings(7, { tax_on_menu_price: true });
        expect(repo.save).toHaveBeenCalledWith(
            expect.objectContaining({ taxOnMenuPrice: true }),
        );
    });
});

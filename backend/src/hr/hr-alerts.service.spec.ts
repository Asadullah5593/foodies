import { HrAlertsService, HrAlertRow } from './hr-alerts.service';

/**
 * The sweep's job is not to find conditions — the four query methods do that —
 * but to reconcile them with what is already open. The case that matters is the
 * one with NO rows: a branch whose last document was renewed produces nothing,
 * and if the sweep only visited branches with rows, its notification would stay
 * open forever.
 */
describe('HrAlertsService.sweep', () => {
    const row = (over: Partial<HrAlertRow> = {}): HrAlertRow => ({
        kind: 'document_expiring',
        dedupeKey: 'hr.document_expiring:1:2026-09-01',
        tenantId: 3,
        branchId: 10,
        employeeId: 7,
        employeeName: 'Bilal Ahmed',
        employeeCode: 'EMP-0007',
        date: '2026-09-01',
        label: 'cnic — Bilal Ahmed',
        detail: 'Expires 2026-09-01',
        link: '/admin/hr/employees/7',
        ...over,
    });

    function makeService() {
        const notifications = {
            syncSystemAlerts: jest.fn().mockResolvedValue({
                opened: 1,
                resolved: 0,
            }),
            openAlertScopes: jest.fn().mockResolvedValue([]),
        };
        const noop = {} as never;
        const service = new HrAlertsService(
            noop, // documents
            noop, // trainings
            noop, // employees
            noop, // cycles
            notifications as never,
        );
        // The queries are exercised against a real database; here we care only
        // about what the sweep does with their output.
        jest.spyOn(service, 'expiringDocuments').mockResolvedValue([]);
        jest.spyOn(service, 'expiringTrainings').mockResolvedValue([]);
        jest.spyOn(service, 'endingProbations').mockResolvedValue([]);
        jest.spyOn(service, 'overdueReviews').mockResolvedValue([]);
        return { service, notifications };
    }

    it('sweeps a branch whose conditions have all cleared, so its alert can resolve', async () => {
        const { service, notifications } = makeService();
        // No documents expiring anywhere, but branch 10 still holds an open one.
        notifications.openAlertScopes.mockImplementation((type: string) =>
            Promise.resolve(
                type === 'hr.document_expiring'
                    ? [{ tenantId: 3, branchId: 10 }]
                    : [],
            ),
        );
        notifications.syncSystemAlerts.mockResolvedValue({
            opened: 0,
            resolved: 1,
        });

        const result = await service.sweep();

        expect(notifications.syncSystemAlerts).toHaveBeenCalledWith(
            3,
            10,
            'hr.document_expiring',
            [], // empty item list is what triggers the resolve
        );
        expect(result.resolved).toBe(1);
    });

    it('does not sweep a branch twice when it both has rows and an open alert', async () => {
        const { service, notifications } = makeService();
        jest.spyOn(service, 'expiringDocuments').mockResolvedValue([row()]);
        notifications.openAlertScopes.mockImplementation((type: string) =>
            Promise.resolve(
                type === 'hr.document_expiring'
                    ? [{ tenantId: 3, branchId: 10 }]
                    : [],
            ),
        );

        await service.sweep();

        const documentCalls = notifications.syncSystemAlerts.mock.calls.filter(
            (c: unknown[]) => c[2] === 'hr.document_expiring',
        );
        expect(documentCalls).toHaveLength(1);
    });

    it('keeps each branch to its own rows', async () => {
        const { service, notifications } = makeService();
        jest.spyOn(service, 'expiringDocuments').mockResolvedValue([
            row({ branchId: 10, dedupeKey: 'a' }),
            row({ branchId: 11, dedupeKey: 'b' }),
        ]);

        await service.sweep();

        const calls = notifications.syncSystemAlerts.mock.calls.filter(
            (c: unknown[]) => c[2] === 'hr.document_expiring',
        );
        expect(calls).toHaveLength(2);
        for (const [, branchId, , items] of calls) {
            expect(items).toHaveLength(1);
            expect((items as Array<{ dedupeKey: string }>)[0].dedupeKey).toBe(
                branchId === 10 ? 'a' : 'b',
            );
        }
    });

    it('carries the alert’s own destination so the bell can navigate', async () => {
        const { service, notifications } = makeService();
        jest.spyOn(service, 'overdueReviews').mockResolvedValue([
            row({ kind: 'review_overdue', link: '/admin/hr/reviews/42' }),
        ]);

        await service.sweep();

        const calls = notifications.syncSystemAlerts.mock.calls as unknown[][];
        const call = calls.find((c) => c[2] === 'hr.review_overdue');
        const items = call?.[3] as Array<{ data: Record<string, unknown> }>;
        expect(items[0].data.link).toBe('/admin/hr/reviews/42');
        expect(items[0].data.branchId).toBe(10);
    });

    it('does not let one branch failing stop the rest of the sweep', async () => {
        const { service, notifications } = makeService();
        jest.spyOn(service, 'expiringDocuments').mockResolvedValue([
            row({ branchId: 10, dedupeKey: 'a' }),
            row({ branchId: 11, dedupeKey: 'b' }),
        ]);
        notifications.syncSystemAlerts.mockImplementation(
            (_t: number, branchId: number) =>
                branchId === 10
                    ? Promise.reject(new Error('boom'))
                    : Promise.resolve({ opened: 1, resolved: 0 }),
        );

        const result = await service.sweep();

        expect(result.opened).toBe(1);
    });
});

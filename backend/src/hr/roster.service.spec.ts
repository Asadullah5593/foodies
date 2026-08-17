import { RosterService } from './roster.service';
import { HrUser } from './employee-scope';

/**
 * The roster's load-bearing rule is what an EMPTY cell means. Absence of a row
 * means "use the employee's default template" — the attendance engine already
 * behaves that way — so clearing a cell must delete the row. Storing an empty
 * row instead would shadow the default and quietly unschedule someone.
 */
describe('RosterService.setCells', () => {
    const user = {
        id: 4,
        tenantId: 3,
        allowedBranchIds: null,
        allowedBrandIds: null,
    } as unknown as HrUser;

    function makeService(existing: Record<string, { id: number }> = {}) {
        const schedules = {
            findOne: jest.fn(({ where }: { where: Record<string, string> }) =>
                Promise.resolve(
                    existing[`${where.employeeId}:${where.workDate}`] ?? null,
                ),
            ),
            create: jest.fn((v: unknown) => v),
            save: jest.fn().mockResolvedValue({ id: 99 }),
            update: jest.fn().mockResolvedValue(undefined),
            delete: jest.fn().mockResolvedValue(undefined),
        };
        const templates = { find: jest.fn().mockResolvedValue([{ id: 5 }]) };
        const recompute = { recomputeDay: jest.fn().mockResolvedValue(null) };
        const audit = { record: jest.fn().mockResolvedValue(undefined) };
        const service = new RosterService(
            schedules as never,
            templates as never,
            {} as never,
            recompute as never,
            audit as never,
        );
        return { service, schedules, templates, recompute };
    }

    it('deletes the row when a cell is cleared', async () => {
        const { service, schedules } = makeService({
            '7:2026-08-20': { id: 12 },
        });

        const res = await service.setCells(user, 10, [
            { employee_id: 7, work_date: '2026-08-20' },
        ]);

        expect(schedules.delete).toHaveBeenCalledWith({ id: 12 });
        expect(schedules.save).not.toHaveBeenCalled();
        expect(res).toEqual({ written: 0, cleared: 1 });
    });

    it('does nothing when clearing a cell that was never set', async () => {
        const { service, schedules, recompute } = makeService();

        const res = await service.setCells(user, 10, [
            { employee_id: 7, work_date: '2026-08-20' },
        ]);

        expect(schedules.delete).not.toHaveBeenCalled();
        expect(res).toEqual({ written: 0, cleared: 0 });
        // Nothing changed, so nothing needed recomputing.
        expect(recompute.recomputeDay).not.toHaveBeenCalled();
    });

    it('lets a holiday win over a weekly off on the same day', async () => {
        const { service, schedules } = makeService();

        await service.setCells(user, 10, [
            {
                employee_id: 7,
                work_date: '2026-08-14',
                is_weekly_off: true,
                is_holiday: true,
            },
        ]);

        const saveCalls = schedules.save.mock.calls as unknown[][];
        const saved = saveCalls[0][0] as {
            isHoliday: boolean;
            isWeeklyOff: boolean;
        };
        expect(saved.isHoliday).toBe(true);
        expect(saved.isWeeklyOff).toBe(false);
    });

    it('recomputes every date it touched so the register agrees', async () => {
        const { service, recompute } = makeService();

        await service.setCells(user, 10, [
            { employee_id: 7, work_date: '2026-08-20', template_id: 5 },
            { employee_id: 8, work_date: '2026-08-21', is_weekly_off: true },
        ]);

        expect(recompute.recomputeDay).toHaveBeenCalledWith(7, '2026-08-20');
        expect(recompute.recomputeDay).toHaveBeenCalledWith(8, '2026-08-21');
    });

    it('rejects a template from another tenant', async () => {
        const { service, templates } = makeService();
        templates.find.mockResolvedValue([]); // nothing matched tenant + id

        await expect(
            service.setCells(user, 10, [
                { employee_id: 7, work_date: '2026-08-20', template_id: 5 },
            ]),
        ).rejects.toThrow('Unknown schedule template');
    });

    it('refuses a branch outside the caller’s scope', async () => {
        const { service } = makeService();
        const scoped = { ...user, allowedBranchIds: [11] } as unknown as HrUser;

        await expect(
            service.setCells(scoped, 10, [
                {
                    employee_id: 7,
                    work_date: '2026-08-20',
                    is_weekly_off: true,
                },
            ]),
        ).rejects.toThrow('out of your scope');
    });

    it('rejects a malformed date rather than storing it', async () => {
        const { service } = makeService();

        await expect(
            service.setCells(user, 10, [
                {
                    employee_id: 7,
                    work_date: '20-08-2026',
                    is_weekly_off: true,
                },
            ]),
        ).rejects.toThrow('Bad work date');
    });
});

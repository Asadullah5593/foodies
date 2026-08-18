import { HrSettingsService } from './hr-settings.service';
import { HrUser } from './employee-scope';

/**
 * The guardrails, not the CRUD.
 *
 * Each of these is a setting that looks harmless in a form and breaks something
 * downstream: a shift wrongly flagged as crossing midnight, offs both carried
 * and encashed, a second monthly-off type, or an approval rule that quietly
 * demotes who may sign a payslip off.
 */
describe('HrSettingsService', () => {
    const owner = {
        id: 1,
        tenantId: 3,
        allowedBranchIds: null,
        allowedBrandIds: null,
        permissions: ['hr-settings:manage'],
    } as unknown as HrUser;

    const branchManager = {
        id: 2,
        tenantId: 3,
        allowedBranchIds: [10],
        allowedBrandIds: null,
        permissions: ['hr-settings:manage'],
    } as unknown as HrUser;

    function makeService(overrides: Record<string, unknown> = {}) {
        const repo = () => ({
            createQueryBuilder: jest.fn(() => ({
                where: jest.fn().mockReturnThis(),
                andWhere: jest.fn().mockReturnThis(),
                orderBy: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockResolvedValue([]),
            })),
            findOne: jest.fn().mockResolvedValue(null),
            find: jest.fn().mockResolvedValue([]),
            create: jest.fn((v: unknown) => v),
            save: jest.fn().mockResolvedValue({ id: 7 }),
            update: jest.fn().mockResolvedValue(undefined),
            delete: jest.fn().mockResolvedValue(undefined),
        });
        const repos = {
            templates: repo(),
            capturePolicies: repo(),
            overtimePolicies: repo(),
            holidayPolicies: repo(),
            leaveTypes: repo(),
            deductionRules: repo(),
            approvalRules: repo(),
            ...overrides,
        };
        const audit = { record: jest.fn().mockResolvedValue(undefined) };
        const service = new HrSettingsService(
            repos.templates as never,
            repos.capturePolicies as never,
            repos.overtimePolicies as never,
            repos.holidayPolicies as never,
            repos.leaveTypes as never,
            repos.deductionRules as never,
            repos.approvalRules as never,
            audit as never,
        );
        return { service, repos, audit };
    }

    describe('schedule templates', () => {
        it('derives crossesMidnight instead of trusting the request', async () => {
            const { service, repos } = makeService();
            await service.saveTemplate(owner, {
                name: 'Late',
                startTime: '18:00',
                endTime: '02:00',
                // A caller insisting otherwise must not be believed: a wrong flag
                // computes a 33-hour scheduled day and zeroes everyone's overtime.
                crossesMidnight: false,
            } as never);
            const calls = repos.templates.save.mock.calls as unknown[][];
            const saved = calls[0][0] as { crossesMidnight: boolean };
            expect(saved.crossesMidnight).toBe(true);
        });

        it('clears the flag for a same-day shift', async () => {
            const { service, repos } = makeService();
            await service.saveTemplate(owner, {
                name: 'Morning',
                startTime: '11:00',
                endTime: '20:00',
                crossesMidnight: true,
            } as never);
            const calls = repos.templates.save.mock.calls as unknown[][];
            const saved = calls[0][0] as { crossesMidnight: boolean };
            expect(saved.crossesMidnight).toBe(false);
        });

        it('deactivates rather than deletes, so old payslips stay explainable', async () => {
            const templates = {
                createQueryBuilder: jest.fn(),
                findOne: jest.fn().mockResolvedValue({
                    id: 4,
                    tenantId: 3,
                    branchId: null,
                }),
                find: jest.fn(),
                create: jest.fn(),
                save: jest.fn(),
                update: jest.fn().mockResolvedValue(undefined),
                delete: jest.fn(),
            };
            const { service } = makeService({ templates });
            await service.deactivateTemplate(owner, 4);
            expect(templates.update).toHaveBeenCalledWith(
                { id: 4 },
                { isActive: false },
            );
            expect(templates.delete).not.toHaveBeenCalled();
        });
    });

    describe('scope', () => {
        it('stops a branch manager editing the tenant-wide default', async () => {
            const { service } = makeService();
            await expect(
                service.saveTemplate(branchManager, {
                    name: 'Everywhere',
                    startTime: '09:00',
                    endTime: '17:00',
                    branchId: null,
                } as never),
            ).rejects.toThrow('all-branches user');
        });

        it('stops a branch manager editing another branch', async () => {
            const { service } = makeService();
            await expect(
                service.saveTemplate(branchManager, {
                    name: 'Other branch',
                    startTime: '09:00',
                    endTime: '17:00',
                    branchId: 11,
                } as never),
            ).rejects.toThrow('out of your scope');
        });
    });

    describe('offs policy', () => {
        it('refuses to both carry forward and encash the same day', async () => {
            const { service } = makeService();
            await expect(
                service.saveHolidayPolicy(owner, {
                    offsPerMonth: 4,
                    carryForward: true,
                    encashUnused: true,
                } as never),
            ).rejects.toThrow('carry forward or be encashed');
        });

        it('rejects an impossible entitlement', async () => {
            const { service } = makeService();
            await expect(
                service.saveHolidayPolicy(owner, { offsPerMonth: 40 } as never),
            ).rejects.toThrow('0–31');
        });
    });

    describe('capture policy', () => {
        it('refuses a second policy for the same scope', async () => {
            const capturePolicies = {
                createQueryBuilder: jest.fn(),
                findOne: jest.fn().mockResolvedValue({ id: 2 }),
                find: jest.fn(),
                create: jest.fn(),
                save: jest.fn(),
                update: jest.fn(),
                delete: jest.fn(),
            };
            const { service } = makeService({ capturePolicies });
            await expect(
                service.saveCapturePolicy(owner, {
                    primaryMethod: 'pin',
                    branchId: 10,
                } as never),
            ).rejects.toThrow('already has a capture policy');
        });

        it('refuses a photo-first policy that makes photos optional', async () => {
            const { service } = makeService();
            await expect(
                service.saveCapturePolicy(owner, {
                    primaryMethod: 'photo',
                    requirePhoto: false,
                } as never),
            ).rejects.toThrow('cannot also make photos optional');
        });

        it('will not delete the tenant default', async () => {
            const capturePolicies = {
                createQueryBuilder: jest.fn(),
                findOne: jest
                    .fn()
                    .mockResolvedValue({ id: 1, tenantId: 3, branchId: null }),
                find: jest.fn(),
                create: jest.fn(),
                save: jest.fn(),
                update: jest.fn(),
                delete: jest.fn(),
            };
            const { service } = makeService({ capturePolicies });
            await expect(service.deleteCapturePolicy(owner, 1)).rejects.toThrow(
                'cannot be deleted',
            );
        });
    });

    describe('leave types', () => {
        it('will not move the monthly-off flag once set', async () => {
            const leaveTypes = {
                createQueryBuilder: jest.fn(),
                findOne: jest.fn().mockResolvedValue({
                    id: 3,
                    tenantId: 3,
                    isMonthlyOff: true,
                }),
                find: jest.fn(),
                create: jest.fn(),
                save: jest.fn(),
                update: jest.fn(),
                delete: jest.fn(),
            };
            const { service } = makeService({ leaveTypes });
            await expect(
                service.saveLeaveType(owner, {
                    id: 3,
                    name: 'Monthly off',
                    isMonthlyOff: false,
                } as never),
            ).rejects.toThrow('cannot be changed');
        });

        it('refuses a second monthly-off type', async () => {
            const leaveTypes = {
                createQueryBuilder: jest.fn(),
                findOne: jest
                    .fn()
                    .mockImplementation(
                        ({ where }: { where: Record<string, unknown> }) =>
                            Promise.resolve(
                                where.isMonthlyOff ? { id: 3 } : null,
                            ),
                    ),
                find: jest.fn(),
                create: jest.fn(),
                save: jest.fn(),
                update: jest.fn(),
                delete: jest.fn(),
            };
            const { service } = makeService({ leaveTypes });
            await expect(
                service.saveLeaveType(owner, {
                    name: 'Another off',
                    isMonthlyOff: true,
                } as never),
            ).rejects.toThrow('already a monthly-off type');
        });
    });

    describe('deduction rules', () => {
        it('refuses a late rule with no ladder', async () => {
            const { service } = makeService();
            await expect(
                service.saveDeductionRule(owner, {
                    trigger: 'late',
                    effectType: 'deduct_days',
                    condition: {},
                } as never),
            ).rejects.toThrow('needs a ladder');
        });

        it('refuses a negative ladder position', async () => {
            const { service } = makeService();
            await expect(
                service.saveDeductionRule(owner, {
                    trigger: 'late',
                    effectType: 'deduct_days',
                    condition: { ladder: [0, -1] },
                } as never),
            ).rejects.toThrow('zero or more days');
        });

        it('falls back to the shipped defaults when a tenant has no rules', async () => {
            const { service } = makeService();
            const config = await service.deductionConfigFor(3, {
                branchId: 10,
            });
            expect(config.lateLadder).toEqual([0, 0.5, 0.5]);
            expect(config.absentDays).toBe(1);
        });
    });

    describe('approval enforcement', () => {
        const rule = (over: Record<string, unknown> = {}) => ({
            id: 1,
            tenantId: 3,
            branchId: null,
            subject: 'attendance_waiver',
            condition: { amountGt: 2000 },
            requiredPermission: 'all-branches:access',
            escalateToPermission: 'all-branches:access',
            priority: 0,
            isActive: true,
            ...over,
        });

        it('does nothing when no rules are configured', async () => {
            const { service } = makeService();
            await expect(
                service.assertApproval(
                    branchManager,
                    'attendance_waiver',
                    { tenantId: 3, branchId: 10 },
                    { amount: 999_999 },
                ),
            ).resolves.toBeUndefined();
        });

        it('blocks below-limit approvers above the threshold', async () => {
            const approvalRules = {
                createQueryBuilder: jest.fn(),
                findOne: jest.fn(),
                find: jest.fn().mockResolvedValue([rule()]),
                create: jest.fn(),
                save: jest.fn(),
                update: jest.fn(),
                delete: jest.fn(),
            };
            const { service } = makeService({ approvalRules });
            await expect(
                service.assertApproval(
                    branchManager,
                    'attendance_waiver',
                    { tenantId: 3, branchId: 10 },
                    { amount: 5000 },
                ),
            ).rejects.toThrow('above your approval limit');
        });

        it('lets the same person through below the threshold', async () => {
            const approvalRules = {
                createQueryBuilder: jest.fn(),
                findOne: jest.fn(),
                find: jest.fn().mockResolvedValue([rule()]),
                create: jest.fn(),
                save: jest.fn(),
                update: jest.fn(),
                delete: jest.fn(),
            };
            const { service } = makeService({ approvalRules });
            await expect(
                service.assertApproval(
                    branchManager,
                    'attendance_waiver',
                    { tenantId: 3, branchId: 10 },
                    { amount: 1500 },
                ),
            ).resolves.toBeUndefined();
        });

        it('lets somebody holding the required permission through', async () => {
            const approvalRules = {
                createQueryBuilder: jest.fn(),
                findOne: jest.fn(),
                find: jest.fn().mockResolvedValue([rule()]),
                create: jest.fn(),
                save: jest.fn(),
                update: jest.fn(),
                delete: jest.fn(),
            };
            const { service } = makeService({ approvalRules });
            const gm = {
                ...(branchManager as unknown as Record<string, unknown>),
                permissions: ['all-branches:access'],
            } as unknown as HrUser;
            await expect(
                service.assertApproval(
                    gm,
                    'attendance_waiver',
                    { tenantId: 3, branchId: 10 },
                    { amount: 5000 },
                ),
            ).resolves.toBeUndefined();
        });

        it('never applies to a super admin', async () => {
            const { service, repos } = makeService();
            await service.assertApproval(
                { id: 9, tenantId: null } as unknown as HrUser,
                'payroll_run',
                { tenantId: null },
                { amount: 10_000_000 },
            );
            expect(repos.approvalRules.find).not.toHaveBeenCalled();
        });
    });
});

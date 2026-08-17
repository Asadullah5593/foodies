import { SelectQueryBuilder } from 'typeorm';

/**
 * The enriched request user, as `RoleAccessGuard` leaves it.
 *
 * `allowedBranchIds === null` means all branches (the user holds
 * `all-branches:access`); `allowedBrandIds === null` means not brand-locked.
 */
export type HrUser = {
    id: number;
    tenantId: number | null;
    allowedBranchIds?: number[] | null;
    allowedBrandIds?: number[] | null;
    permissions?: string[];
};

/**
 * Can this user see an employee whose CURRENT assignment sits at this branch
 * and brand?
 *
 * The one non-obvious rule: a brand-locked manager also sees **brand-null**
 * staff at their branches. Cleaners, security and porters belong to the branch
 * rather than to a brand, and hiding them from the only manager on that floor
 * would make them unmanageable — nobody could mark the cleaner present.
 * (docs/HRM.md §14.3, decision #15.)
 *
 * Exported separately from the query builders so this rule is testable without
 * a database.
 */
export function canSeeAssignment(
    assignment: { branchId: number; brandId: number | null },
    user: Pick<HrUser, 'allowedBranchIds' | 'allowedBrandIds'>,
): boolean {
    const branches = user.allowedBranchIds;
    if (branches != null && !branches.includes(assignment.branchId)) {
        return false;
    }
    const brands = user.allowedBrandIds;
    if (brands != null) {
        // null brand = shared branch staff, visible to every manager there.
        if (assignment.brandId != null && !brands.includes(assignment.brandId))
            return false;
    }
    return true;
}

/**
 * Apply tenant + branch + brand scoping to a query already joined to the
 * employee's current assignment under `alias`.
 *
 * Super admin (`tenantId == null`) is unscoped, consistent with the rest of the
 * platform.
 */
export function applyEmployeeScope<T extends object>(
    qb: SelectQueryBuilder<T>,
    user: HrUser,
    employeeAlias: string,
    assignmentAlias: string,
): SelectQueryBuilder<T> {
    if (user.tenantId == null) return qb;

    qb.andWhere(`${employeeAlias}.tenantId = :scopeTenantId`, {
        scopeTenantId: user.tenantId,
    });

    const branches = user.allowedBranchIds;
    if (branches != null) {
        // An empty allow-list means no branches, which must match nothing
        // rather than degrade into "no filter".
        if (branches.length === 0) {
            qb.andWhere('1 = 0');
            return qb;
        }
        qb.andWhere(`${assignmentAlias}.branchId IN (:...scopeBranchIds)`, {
            scopeBranchIds: branches,
        });
    }

    const brands = user.allowedBrandIds;
    if (brands != null) {
        if (brands.length === 0) {
            qb.andWhere(`${assignmentAlias}.brandId IS NULL`);
            return qb;
        }
        qb.andWhere(
            `(${assignmentAlias}.brandId IS NULL OR ${assignmentAlias}.brandId IN (:...scopeBrandIds))`,
            { scopeBrandIds: brands },
        );
    }

    return qb;
}

/** Does this user hold the permission, after umbrella expansion by the guard? */
export function hasPermission(user: HrUser, permission: string): boolean {
    if (user.tenantId == null) return true; // super admin
    return (user.permissions ?? []).includes(permission);
}

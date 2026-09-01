import { ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RoleAccessGuard } from './role-access.guard';
import { RequirePermissionGuard } from '../roles/require-permission.guard';

/**
 * Super admin used to be inferred from ABSENCE — no tenant_users row meant
 * platform owner. Deleting a user removes the tenant link first and the users
 * row last, so a delete that failed part way through did not remove access, it
 * granted all of it. Four accounts reached production that way.
 *
 * These pin the rule that replaced it: power comes from a flag on the row, and
 * an account attached to no business can reach nothing.
 */

const ctx = (user: unknown) =>
    ({
        switchToHttp: () => ({
            getRequest: () => ({ user, path: '/admin/users' }),
        }),
        getHandler: () => () => undefined,
    }) as never;

describe('RoleAccessGuard — a tenant-less account', () => {
    const guard = (rows: unknown[] = []) =>
        new RoleAccessGuard({
            query: jest.fn().mockResolvedValue(rows),
        } as unknown as DataSource);

    it('REFUSES an orphan — the leftover of a half-finished delete', async () => {
        await expect(
            guard().canActivate(
                ctx({ id: 68, tenantId: null, isSuperAdmin: false }),
            ),
        ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses an orphan that simply never had the flag set', async () => {
        await expect(
            guard().canActivate(ctx({ id: 68, tenantId: null })),
        ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets a real platform administrator through', async () => {
        await expect(
            guard().canActivate(
                ctx({ id: 1, tenantId: null, isSuperAdmin: true }),
            ),
        ).resolves.toBe(true);
    });

    it('does not take the flag from a forged request body — it comes off the user row', async () => {
        // request.user is built by JwtStrategy from the database, so a caller
        // cannot set this; the guard reading it is only safe because of that.
        await expect(
            guard().canActivate(
                ctx({ id: 68, tenantId: null, isSuperAdmin: 'yes' }),
            ),
        ).rejects.toBeInstanceOf(ForbiddenException);
    });
});

describe('RequirePermissionGuard — the gate on every write', () => {
    const reflector = (required: string[]) =>
        ({ get: () => required }) as never;
    const guard = (required: string[], rows: unknown[] = []) =>
        new RequirePermissionGuard(reflector(required), {
            query: jest.fn().mockResolvedValue(rows),
        } as unknown as DataSource);

    it('REFUSES an orphan instead of waving it through', async () => {
        await expect(
            guard(['users:delete']).canActivate(
                ctx({ id: 68, tenantId: null, isSuperAdmin: false }),
            ),
        ).resolves.toBe(false);
    });

    it('lets a real platform administrator through', async () => {
        await expect(
            guard(['users:delete']).canActivate(
                ctx({ id: 1, tenantId: null, isSuperAdmin: true }),
            ),
        ).resolves.toBe(true);
    });

    it('still allows an unguarded route', async () => {
        await expect(
            guard([]).canActivate(ctx({ id: 68, tenantId: null })),
        ).resolves.toBe(true);
    });
});

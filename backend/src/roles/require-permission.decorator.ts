import { SetMetadata } from '@nestjs/common';
import { PermissionName } from './permissions.dto';

export const REQUIRE_PERMISSION_KEY = 'require_permission';

/**
 * Guard the handler with one or more permissions (any-of). The check is
 * umbrella-aware: a role holding an umbrella permission (e.g. menu:manage)
 * satisfies the implied granular permissions via expandPermissions().
 */
export const RequirePermission = (...permissions: PermissionName[]) =>
    SetMetadata(REQUIRE_PERMISSION_KEY, permissions);

import { SetMetadata } from '@nestjs/common';
import { PermissionName } from './permissions.dto';

export const REQUIRE_PERMISSION_KEY = 'require_permission';

export const RequirePermission = (permission: PermissionName) =>
    SetMetadata(REQUIRE_PERMISSION_KEY, permission);

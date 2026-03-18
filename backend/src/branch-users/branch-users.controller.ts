import {
    Controller,
    Get,
    Post,
    Delete,
    Body,
    Param,
    UseGuards,
    ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { BranchUsersService } from './branch-users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../roles/require-permission.decorator';
import { RequirePermissionGuard } from '../roles/require-permission.guard';
import { Permissions } from '../roles/permissions.dto';

@ApiTags('Admin – Branch Users')
@ApiBearerAuth()
@Controller('admin/branches')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class BranchUsersController {
    constructor(private service: BranchUsersService) {}

    @Get(':branchId/users')
    index(
        @CurrentUser() user: {
            tenantId: number | null;
            allowedBranchIds?: number[] | null;
        },
        @Param('branchId') branchId: string,
    ) {
        if (branchId === 'all')
            return this.service.findAllForAdmin(
                user.tenantId,
                user.allowedBranchIds,
            );
        const bid = +branchId;
        if (
            user.allowedBranchIds != null &&
            Array.isArray(user.allowedBranchIds) &&
            user.allowedBranchIds.length > 0 &&
            !user.allowedBranchIds.includes(bid)
        ) {
            throw new ForbiddenException(
                'You do not have access to this branch',
            );
        }
        return this.service.getUsers(bid);
    }

    @Post(':branchId/users')
    @UseGuards(RequirePermissionGuard)
    @RequirePermission(Permissions.BRANCH_USERS_ASSIGN)
    store(
        @CurrentUser() user: {
            tenantId: number | null;
            allowedBranchIds?: number[] | null;
        },
        @Param('branchId') branchId: string,
        @Body()
        body: {
            user_ids?: number[];
            role_id?: number;
            assignments?: { user_id: number; role_id: number }[];
        },
    ) {
        const bid = +branchId;
        if (
            user.allowedBranchIds != null &&
            Array.isArray(user.allowedBranchIds) &&
            user.allowedBranchIds.length > 0 &&
            !user.allowedBranchIds.includes(bid)
        ) {
            throw new ForbiddenException(
                'You do not have access to this branch',
            );
        }
        if (body.assignments?.length) {
            return this.service.assignUsersWithRoles(bid, body.assignments);
        }
        return this.service.assignUsers(
            bid,
            body.user_ids ?? [],
            body.role_id,
        );
    }

    @Delete(':branchId/users/:userId')
    @UseGuards(RequirePermissionGuard)
    @RequirePermission(Permissions.BRANCH_USERS_ASSIGN)
    destroy(
        @CurrentUser() user: {
            tenantId: number | null;
            allowedBranchIds?: number[] | null;
        },
        @Param('branchId') branchId: string,
        @Param('userId') userId: string,
    ) {
        const bid = +branchId;
        if (
            user.allowedBranchIds != null &&
            Array.isArray(user.allowedBranchIds) &&
            user.allowedBranchIds.length > 0 &&
            !user.allowedBranchIds.includes(bid)
        ) {
            throw new ForbiddenException(
                'You do not have access to this branch',
            );
        }
        return this.service.removeUser(bid, +userId);
    }
}

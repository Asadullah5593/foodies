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
        @CurrentUser()
        user: {
            tenantId: number | null;
            allowedBranchIds?: number[] | null;
            allowedBrandIds?: number[] | null;
        },
        @Param('branchId') branchId: string,
    ) {
        if (branchId === 'all')
            return this.service.findAllForAdmin(
                user.tenantId,
                user.allowedBranchIds,
                user.allowedBrandIds,
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
        return this.service.getUsers(bid, user.allowedBrandIds);
    }

    @Post(':branchId/users')
    @UseGuards(RequirePermissionGuard)
    @RequirePermission(Permissions.BRANCH_USERS_ASSIGN)
    store(
        @CurrentUser()
        user: {
            tenantId: number | null;
            allowedBranchIds?: number[] | null;
            allowedBrandIds?: number[] | null;
        },
        @Param('branchId') branchId: string,
        @Body()
        body: {
            user_ids?: number[];
            role_id?: number;
            assignments?: {
                user_id: number;
                role_id: number;
                /** One brand; `brand_ids` wins when both are sent. */
                brand_id?: number | null;
                /** Lock to several of the branch's brands; empty = all brands. */
                brand_ids?: number[] | null;
                /** Required for the rider role when the user has no phone yet. */
                phone?: string | null;
            }[];
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
            return this.service.assignUsersWithRoles(
                bid,
                body.assignments,
                user.allowedBrandIds,
            );
        }
        return this.service.assignUsers(
            bid,
            body.user_ids ?? [],
            body.role_id,
            user.allowedBrandIds,
        );
    }

    @Post('bulk-assign')
    @UseGuards(RequirePermissionGuard)
    @RequirePermission(Permissions.BRANCH_USERS_ASSIGN)
    bulkAssign(
        @CurrentUser()
        user: {
            tenantId: number | null;
            allowedBranchIds?: number[] | null;
            allowedBrandIds?: number[] | null;
        },
        @Body()
        body: {
            user_id: number;
            branch_ids: number[];
            role_id: number;
            /** One brand; `brand_ids` wins when both are sent. */
            brand_id?: number | null;
            /** Lock to several of the branch's brands; empty = all brands. */
            brand_ids?: number[] | null;
            /** Required for the rider role when the user has no phone yet. */
            phone?: string | null;
        },
    ) {
        if (
            user.allowedBranchIds != null &&
            body.branch_ids.some((id) => !user.allowedBranchIds!.includes(id))
        ) {
            throw new ForbiddenException(
                'You do not have access to one or more selected branches',
            );
        }
        return this.service.bulkAssignUserToBranches(
            body,
            user.allowedBrandIds,
        );
    }

    @Delete(':branchId/users/:userId')
    @UseGuards(RequirePermissionGuard)
    @RequirePermission(Permissions.BRANCH_USERS_REMOVE)
    destroy(
        @CurrentUser()
        user: {
            tenantId: number | null;
            allowedBranchIds?: number[] | null;
            allowedBrandIds?: number[] | null;
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
        return this.service.removeUser(bid, +userId, user.allowedBrandIds);
    }
}

import {
    Controller,
    Get,
    Post,
    Delete,
    Body,
    Param,
    UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { BranchUsersService } from './branch-users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../roles/require-permission.decorator';
import { RequirePermissionGuard } from '../roles/require-permission.guard';

@ApiTags('Admin – Branch Users')
@ApiBearerAuth()
@Controller('admin/branches')
@UseGuards(JwtAuthGuard)
export class BranchUsersController {
    constructor(private service: BranchUsersService) {}

    @Get(':branchId/users')
    index(
        @CurrentUser() user: { tenantId: number | null },
        @Param('branchId') branchId: string,
    ) {
        if (branchId === 'all')
            return this.service.findAllForAdmin(user.tenantId);
        return this.service.getUsers(+branchId);
    }

    @Post(':branchId/users')
    @UseGuards(RequirePermissionGuard)
    @RequirePermission('branch-users:assign')
    store(
        @Param('branchId') branchId: string,
        @Body()
        body: {
            user_ids?: number[];
            role_id?: number;
            assignments?: { user_id: number; role_id: number }[];
        },
    ) {
        if (body.assignments?.length) {
            return this.service.assignUsersWithRoles(
                +branchId,
                body.assignments,
            );
        }
        return this.service.assignUsers(
            +branchId,
            body.user_ids ?? [],
            body.role_id,
        );
    }

    @Delete(':branchId/users/:userId')
    @UseGuards(RequirePermissionGuard)
    @RequirePermission('branch-users:assign')
    destroy(
        @Param('branchId') branchId: string,
        @Param('userId') userId: string,
    ) {
        return this.service.removeUser(+branchId, +userId);
    }
}

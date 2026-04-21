import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    Query,
    UseGuards,
    ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ShiftsService } from './shifts.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('Admin – Shifts')
@ApiBearerAuth()
@Controller('admin/shifts')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class ShiftsController {
    constructor(private service: ShiftsService) {}

    @Get()
    index(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBranchIds?: number[] | null;
        },
        @Query('branch_id') branchId: string,
        @Query('status') status: string,
    ) {
        return this.service.findAll(
            branchId ? +branchId : undefined,
            status,
            user.tenantId,
            user.allowedBranchIds,
        );
    }

    @Get(':id')
    show(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBranchIds?: number[] | null;
        },
        @Param('id') id: string,
    ) {
        return this.service.findOne(+id, user.tenantId, user.allowedBranchIds);
    }

    @Post()
    store(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBranchIds?: number[] | null;
        },
        @Body()
        dto: {
            branch_id: number;
            user_id: number;
            opening_cash: number;
            notes?: string;
        },
    ) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.create(dto, user.allowedBranchIds);
    }

    @Post(':id/close')
    close(
        @Param('id') id: string,
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            allowedBranchIds?: number[] | null;
        },
        @Body() dto: { actual_cash: number; notes?: string },
    ) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.close(
            +id,
            dto,
            user.tenantId,
            user.allowedBranchIds,
        );
    }
}

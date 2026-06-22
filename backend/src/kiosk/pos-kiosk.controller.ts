import {
    Controller,
    Get,
    Post,
    Param,
    Query,
    Body,
    UseGuards,
    ForbiddenException,
    NotFoundException,
    BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { BranchesService } from '../branches/branches.service';
import { KioskService, KioskPaymentInput } from './kiosk.service';
import { KioskOrderPayload } from '../entities/kiosk-order.entity';

/**
 * Cashier-facing endpoints to look up and finalize a kiosk pay-at-counter cart.
 * Under `/pos/*`, so JwtAuthGuard + RoleAccessGuard require ORDERS_CREATE.
 */
@ApiTags('POS – Kiosk Orders')
@ApiBearerAuth()
@Controller('pos/kiosk-orders')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class PosKioskController {
    constructor(
        private readonly kioskService: KioskService,
        private readonly branchesService: BranchesService,
    ) {}

    private async resolveTenantId(
        user: { tenantId: number | null; isSuperAdmin?: boolean },
        branchId: number,
    ): Promise<number> {
        if (user.tenantId != null) return user.tenantId;
        if (user.isSuperAdmin === true) {
            const tenantId =
                await this.branchesService.getPrimaryTenantId(branchId);
            if (tenantId == null)
                throw new NotFoundException('Branch has no tenant');
            return tenantId;
        }
        throw new ForbiddenException(
            'Tenant context required for kiosk orders',
        );
    }

    @Get(':code')
    async lookup(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            isSuperAdmin?: boolean;
            allowedBrandIds?: number[] | null;
        },
        @Param('code') code: string,
        @Query('branch_id') branchIdRaw: string,
    ) {
        const branchId = Number(branchIdRaw);
        if (!Number.isFinite(branchId) || branchId <= 0)
            throw new BadRequestException('branch_id query param is required');
        const tenantId = await this.resolveTenantId(user, branchId);
        return this.kioskService.lookup(
            code,
            branchId,
            tenantId,
            user.allowedBrandIds ?? null,
        );
    }

    @Post(':code/finalize')
    async finalize(
        @CurrentUser()
        user: {
            id: number;
            tenantId: number | null;
            isSuperAdmin?: boolean;
            allowedBrandIds?: number[] | null;
        },
        @Param('code') code: string,
        @Body()
        dto: {
            branch_id: number;
            order?: KioskOrderPayload;
            payments: KioskPaymentInput[];
        },
    ) {
        const branchId = Number(dto.branch_id);
        if (!Number.isFinite(branchId) || branchId <= 0)
            throw new BadRequestException('branch_id is required');
        const tenantId = await this.resolveTenantId(user, branchId);
        return this.kioskService.finalize(
            code,
            branchId,
            tenantId,
            dto.order,
            dto.payments ?? [],
            user.id,
            user.allowedBrandIds ?? null,
        );
    }
}

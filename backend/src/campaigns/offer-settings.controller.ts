import {
    Controller,
    Get,
    Put,
    Body,
    UseGuards,
    ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../entities/tenant.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../roles/require-permission.decorator';
import { RequirePermissionGuard } from '../roles/require-permission.guard';
import { Permissions } from '../roles/permissions.dto';
import {
    resolveOfferSettings,
    OfferSettings,
} from '../orders/offer-settings';

type User = { id: number; tenantId: number | null };

/** Tenant-level offer engine knobs (stacking, cap, floors, deal/voucher/override toggles). */
@ApiTags('Admin – Offer Settings')
@ApiBearerAuth()
@Controller('admin/offer-settings')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class OfferSettingsController {
    constructor(
        @InjectRepository(Tenant)
        private tenantRepo: Repository<Tenant>,
    ) {}

    @Get()
    async get(@CurrentUser() user: User) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        const t = await this.tenantRepo.findOne({
            where: { id: user.tenantId },
        });
        return resolveOfferSettings(
            (t as { offerSettings?: Partial<OfferSettings> | null })
                ?.offerSettings ?? null,
        );
    }

    @Put()
    @RequirePermission(Permissions.OFFER_SETTINGS_EDIT)
    async put(
        @CurrentUser() user: User,
        @Body() dto: Partial<OfferSettings>,
    ) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        const t = await this.tenantRepo.findOne({
            where: { id: user.tenantId },
        });
        if (!t) throw new ForbiddenException('Tenant not found');
        const merged = resolveOfferSettings({
            ...((t as { offerSettings?: Partial<OfferSettings> | null })
                .offerSettings ?? {}),
            ...dto,
        });
        (t as { offerSettings?: OfferSettings }).offerSettings = merged;
        await this.tenantRepo.save(t);
        return merged;
    }
}

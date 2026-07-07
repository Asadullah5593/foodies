import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoleAccessModule } from '../auth/role-access.module';
import { Campaign } from '../entities/campaign.entity';
import { CampaignItem } from '../entities/campaign-item.entity';
import { Discount } from '../entities/discount.entity';
import { CouponRealization } from '../entities/coupon-realization.entity';
import { Tenant } from '../entities/tenant.entity';
import { CampaignsController } from './campaigns.controller';
import { OfferSettingsController } from './offer-settings.controller';
import { CampaignsService } from './campaigns.service';

@Module({
    imports: [
        RoleAccessModule,
        TypeOrmModule.forFeature([
            Campaign,
            CampaignItem,
            Discount,
            CouponRealization,
            Tenant,
        ]),
    ],
    controllers: [CampaignsController, OfferSettingsController],
    providers: [CampaignsService],
    exports: [CampaignsService],
})
export class CampaignsModule {}

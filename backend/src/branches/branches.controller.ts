import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Body,
    Param,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { BranchesService } from './branches.service';
import { BranchMenuItemsService } from '../branch-menu-items/branch-menu-items.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('Admin – Branches')
@ApiBearerAuth()
@Controller('admin/branches')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class BranchesController {
    constructor(
        private service: BranchesService,
        private branchMenuItemsService: BranchMenuItemsService,
    ) {}

    @Get()
    index(
        @Query('brand_id') brandId: string,
        @CurrentUser() user: { id: number; tenantId: number | null },
    ) {
        return this.service.findAllForAdmin(
            user.tenantId,
            brandId ? +brandId : undefined,
        );
    }

    @Get(':id')
    show(
        @Param('id') id: string,
        @CurrentUser() user: { id: number; tenantId: number | null },
    ) {
        return this.service.findOneForAdmin(+id, user.tenantId);
    }

    @Post()
    async store(
        @Body()
        dto: {
            /** One or more brands (e.g. food court: multiple brands at one branch). */
            brand_ids: number[];
            name: string;
            code?: string;
            address?: string;
            phone?: string;
            email?: string;
            timezone?: string;
            operating_hours?: Record<string, unknown>;
            supports_dine_in?: boolean;
            supports_takeaway?: boolean;
            supports_delivery?: boolean;
            delivery_flat_fee?: number;
            is_active?: boolean;
            menu_enabled?: boolean;
            status?: string;
            latitude?: number | null;
            longitude?: number | null;
            /** Tenant-level menu items to link (copy-on-link) to this new branch. */
            menu_item_ids?: number[];
        },
        @CurrentUser() user: { id: number; tenantId: number | null },
    ) {
        const { menu_item_ids, ...branchDto } = dto;
        const created = await this.service.createForAdmin(
            branchDto,
            user.tenantId,
        );
        if (Array.isArray(menu_item_ids) && menu_item_ids.length) {
            await this.branchMenuItemsService.sync(created.id, menu_item_ids);
        }
        return created;
    }

    @Put(':id')
    async update(
        @Param('id') id: string,
        @Body()
        dto: {
            brand_ids?: number[];
            name?: string;
            code?: string;
            address?: string;
            phone?: string;
            email?: string;
            timezone?: string;
            operating_hours?: Record<string, unknown>;
            supports_dine_in?: boolean;
            supports_takeaway?: boolean;
            supports_delivery?: boolean;
            delivery_flat_fee?: number;
            is_active?: boolean;
            menu_enabled?: boolean;
            status?: string;
            latitude?: number | null;
            longitude?: number | null;
            /** Desired brand-level menu item ids to link to this branch (mapping only). */
            menu_item_ids?: number[];
        },
        @CurrentUser() user: { id: number; tenantId: number | null },
    ) {
        const { menu_item_ids, ...branchDto } = dto;
        const updated = await this.service.updateForAdmin(
            +id,
            user.tenantId,
            branchDto,
        );
        if (Array.isArray(menu_item_ids)) {
            await this.branchMenuItemsService.sync(+id, menu_item_ids);
        }
        return updated;
    }

    @Delete(':id')
    destroy(
        @Param('id') id: string,
        @CurrentUser() user: { id: number; tenantId: number | null },
    ) {
        return this.service.removeForAdmin(+id, user.tenantId);
    }
}

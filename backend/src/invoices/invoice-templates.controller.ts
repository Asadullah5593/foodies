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
    ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { InvoiceTemplatesService } from './invoice-templates.service';
import type {
    InvoiceTemplateDto,
    InvoiceTemplatePurpose,
} from './invoice-templates.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../roles/require-permission.decorator';
import { RequirePermissionGuard } from '../roles/require-permission.guard';
import { Permissions } from '../roles/permissions.dto';

type User = {
    id: number;
    tenantId: number | null;
    allowedBrandIds?: number[] | null;
};

@ApiTags('Admin – Invoice Templates')
@ApiBearerAuth()
@Controller('admin/invoice-templates')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class InvoiceTemplatesController {
    constructor(private service: InvoiceTemplatesService) {}

    @Get()
    index(@CurrentUser() user: User) {
        return this.service.findAll(user.tenantId, user.allowedBrandIds);
    }

    /** Resolved active template (brand → tenant → built-in, per purpose) for the settings preview. */
    @Get('active')
    active(
        @CurrentUser() user: User,
        @Query('brand_id') brandId?: string,
        @Query('purpose') purpose?: string,
    ) {
        const bId =
            brandId != null && brandId !== '' && Number.isFinite(+brandId)
                ? +brandId
                : null;
        return this.service.resolveActive(
            user.tenantId,
            bId,
            user.allowedBrandIds,
            this.normalizePurpose(purpose),
        );
    }

    private normalizePurpose(purpose?: string): InvoiceTemplatePurpose {
        return purpose === 'kitchen' ? 'kitchen' : 'customer';
    }

    @Get(':id')
    show(@Param('id') id: string, @CurrentUser() user: User) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.findOne(+id, user.tenantId, user.allowedBrandIds);
    }

    @Post()
    @RequirePermission(Permissions.INVOICE_TEMPLATES_CREATE)
    store(@CurrentUser() user: User, @Body() dto: InvoiceTemplateDto) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.create(dto, user.tenantId, user.allowedBrandIds);
    }

    @Put(':id')
    @RequirePermission(Permissions.INVOICE_TEMPLATES_EDIT)
    update(
        @Param('id') id: string,
        @CurrentUser() user: User,
        @Body() dto: InvoiceTemplateDto,
    ) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.update(
            +id,
            user.tenantId,
            dto,
            user.allowedBrandIds,
        );
    }

    @Put(':id/activate')
    @RequirePermission(Permissions.INVOICE_TEMPLATES_SET_DEFAULT)
    activate(
        @Param('id') id: string,
        @CurrentUser() user: User,
        @Query('purpose') purpose?: string,
    ) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.activate(
            +id,
            user.tenantId,
            user.allowedBrandIds,
            this.normalizePurpose(purpose),
        );
    }

    @Delete(':id')
    @RequirePermission(Permissions.INVOICE_TEMPLATES_DELETE)
    destroy(@Param('id') id: string, @CurrentUser() user: User) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.remove(+id, user.tenantId, user.allowedBrandIds);
    }
}

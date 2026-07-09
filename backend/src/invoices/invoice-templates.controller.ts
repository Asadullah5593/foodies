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
import type { InvoiceTemplateDto } from './invoice-templates.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';

type User = {
    id: number;
    tenantId: number | null;
    allowedBrandIds?: number[] | null;
};

@ApiTags('Admin – Invoice Templates')
@ApiBearerAuth()
@Controller('admin/invoice-templates')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class InvoiceTemplatesController {
    constructor(private service: InvoiceTemplatesService) {}

    @Get()
    index(@CurrentUser() user: User) {
        return this.service.findAll(user.tenantId, user.allowedBrandIds);
    }

    /** Resolved active template (brand → tenant → built-in) for the settings preview. */
    @Get('active')
    active(@CurrentUser() user: User, @Query('brand_id') brandId?: string) {
        const bId =
            brandId != null && brandId !== '' && Number.isFinite(+brandId)
                ? +brandId
                : null;
        return this.service.resolveActive(user.tenantId, bId, user.allowedBrandIds);
    }

    @Get(':id')
    show(@Param('id') id: string, @CurrentUser() user: User) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.findOne(+id, user.tenantId, user.allowedBrandIds);
    }

    @Post()
    store(@CurrentUser() user: User, @Body() dto: InvoiceTemplateDto) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.create(dto, user.tenantId, user.allowedBrandIds);
    }

    @Put(':id')
    update(
        @Param('id') id: string,
        @CurrentUser() user: User,
        @Body() dto: InvoiceTemplateDto,
    ) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.update(+id, user.tenantId, dto, user.allowedBrandIds);
    }

    @Put(':id/activate')
    activate(@Param('id') id: string, @CurrentUser() user: User) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.activate(+id, user.tenantId, user.allowedBrandIds);
    }

    @Delete(':id')
    destroy(@Param('id') id: string, @CurrentUser() user: User) {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return this.service.remove(+id, user.tenantId, user.allowedBrandIds);
    }
}

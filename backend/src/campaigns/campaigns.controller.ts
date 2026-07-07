import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Body,
    Param,
    UseGuards,
    ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { CampaignsService } from './campaigns.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';

type User = {
    id: number;
    tenantId: number | null;
    allowedBrandIds?: number[] | null;
};

@ApiTags('Admin – Campaigns')
@ApiBearerAuth()
@Controller('admin/campaigns')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class CampaignsController {
    constructor(private service: CampaignsService) {}

    private tid(user: User): number {
        if (!user.tenantId)
            throw new ForbiddenException('Tenant context required');
        return user.tenantId;
    }

    @Get()
    index(@CurrentUser() user: User) {
        return this.service.findAll(user.tenantId, user.allowedBrandIds);
    }

    @Post()
    store(@CurrentUser() user: User, @Body() dto: Record<string, unknown>) {
        return this.service.create(this.tid(user), dto as never);
    }

    @Put(':id')
    update(
        @Param('id') id: string,
        @CurrentUser() user: User,
        @Body() dto: Record<string, unknown>,
    ) {
        return this.service.update(+id, this.tid(user), dto);
    }

    @Delete(':id')
    destroy(@Param('id') id: string, @CurrentUser() user: User) {
        return this.service.remove(+id, this.tid(user));
    }

    @Get(':id/report')
    report(@Param('id') id: string, @CurrentUser() user: User) {
        return this.service.report(+id, this.tid(user));
    }

    // ---- items ----
    @Get(':id/items')
    items(@Param('id') id: string, @CurrentUser() user: User) {
        return this.service.listItems(+id, this.tid(user));
    }

    @Post(':id/items')
    addItem(
        @Param('id') id: string,
        @CurrentUser() user: User,
        @Body() dto: Record<string, unknown>,
    ) {
        return this.service.createItem(+id, this.tid(user), dto as never);
    }

    @Put(':id/items/:itemId')
    editItem(
        @Param('id') id: string,
        @Param('itemId') itemId: string,
        @CurrentUser() user: User,
        @Body() dto: Record<string, unknown>,
    ) {
        return this.service.updateItem(+id, +itemId, this.tid(user), dto);
    }

    @Delete(':id/items/:itemId')
    deleteItem(
        @Param('id') id: string,
        @Param('itemId') itemId: string,
        @CurrentUser() user: User,
    ) {
        return this.service.removeItem(+id, +itemId, this.tid(user));
    }
}

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
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RolesService } from './roles.service';

@ApiTags('Admin – Roles & Permissions')
@ApiBearerAuth()
@Controller('admin/roles')
@UseGuards(JwtAuthGuard)
export class RolesController {
    constructor(private rolesService: RolesService) {}

    @Get('permissions')
    @ApiOperation({ summary: 'List all permissions (system-defined)' })
    listPermissions() {
        return this.rolesService.listPermissions();
    }

    @Get()
    @ApiOperation({
        summary:
            'List roles (tenant users: tenant + system; super admin: all system)',
    })
    listRoles(@CurrentUser() user: { id: number; tenantId: number | null }) {
        return this.rolesService.listRoles(user.tenantId);
    }

    @Get(':id')
    @ApiOperation({ summary: 'Get role by ID with permissions' })
    getRole(
        @Param('id') id: string,
        @CurrentUser() user: { id: number; tenantId: number | null },
    ) {
        return this.rolesService.getRoleById(+id, user.tenantId);
    }

    @Post()
    @ApiOperation({ summary: 'Create a new role (tenant users only)' })
    createRole(
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Body() dto: { name: string; slug: string; permission_ids?: number[] },
    ) {
        if (!user.tenantId)
            throw new ForbiddenException('Only tenant users can create roles');
        return this.rolesService.createRole(user.tenantId, dto);
    }

    @Put(':id')
    @ApiOperation({
        summary:
            'Update role and/or assign permissions (Super Admin role is read-only)',
    })
    updateRole(
        @Param('id') id: string,
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Body()
        dto: { name?: string; slug?: string; permission_ids?: number[] },
    ) {
        if (!user.tenantId)
            throw new ForbiddenException('Only tenant users can update roles');
        return this.rolesService.updateRole(+id, user.tenantId, dto);
    }

    @Delete(':id')
    @ApiOperation({
        summary: 'Delete a role (Super Admin role cannot be deleted)',
    })
    async removeRole(
        @Param('id') id: string,
        @CurrentUser() user: { id: number; tenantId: number | null },
    ) {
        if (!user.tenantId)
            throw new ForbiddenException('Only tenant users can delete roles');
        return this.rolesService.removeRole(+id, user.tenantId);
    }
}

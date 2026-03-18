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
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RolesService } from './roles.service';

@ApiTags('Admin – Roles & Permissions')
@ApiBearerAuth()
@Controller('admin/roles')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class RolesController {
    constructor(private rolesService: RolesService) {}

    @Get('permissions')
    @ApiOperation({ summary: 'List all permissions' })
    listPermissions() {
        return this.rolesService.listPermissions();
    }

    @Post('permissions')
    @ApiOperation({ summary: 'Create a new permission (Super Admin only)' })
    createPermission(
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Body()
        dto: {
            name: string;
            resource: string;
            action: string;
            description?: string | null;
        },
    ) {
        if (user.tenantId != null)
            throw new ForbiddenException(
                'Only Super Admin can create permissions',
            );
        return this.rolesService.createPermission(dto);
    }

    @Put('permissions/:id')
    @ApiOperation({ summary: 'Update a permission (Super Admin only)' })
    updatePermission(
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Param('id') id: string,
        @Body()
        dto: {
            name?: string;
            resource?: string;
            action?: string;
            description?: string | null;
        },
    ) {
        if (user.tenantId != null)
            throw new ForbiddenException(
                'Only Super Admin can update permissions',
            );
        return this.rolesService.updatePermission(+id, dto);
    }

    @Delete('permissions/:id')
    @ApiOperation({ summary: 'Delete a permission (Super Admin only)' })
    deletePermission(
        @CurrentUser() user: { id: number; tenantId: number | null },
        @Param('id') id: string,
    ) {
        if (user.tenantId != null)
            throw new ForbiddenException(
                'Only Super Admin can delete permissions',
            );
        return this.rolesService.deletePermission(+id);
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

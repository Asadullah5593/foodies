import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseIntPipe,
    Patch,
    Post,
    Put,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../roles/require-permission.decorator';
import { RequirePermissionGuard } from '../roles/require-permission.guard';
import { Permissions } from '../roles/permissions.dto';
import { EmployeesService } from './employees.service';
import { EmployeeExitsService } from './employee-exits.service';
import type { HrUser } from './employee-scope';
import {
    ChangeAssignmentDto,
    CreateEmployeeDto,
    EmployeeQueryDto,
    UpdateEmployeeDto,
} from './dto/employee.dto';
import {
    EmployeeDocumentDto,
    EmployeeWarningDto,
    RecordExitDto,
    UpdateClearanceItemDto,
} from './dto/hr-support.dto';

@ApiTags('Admin – Employee HRM')
@ApiBearerAuth()
@Controller('admin/hr/employees')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class EmployeesController {
    constructor(
        private readonly employees: EmployeesService,
        private readonly exits: EmployeeExitsService,
    ) {}

    @Get()
    @RequirePermission(Permissions.EMPLOYEES_VIEW)
    @ApiOperation({
        summary: 'Employee roster',
        description:
            'Scoped to the caller’s branches and brands. Brand-locked users also see brand-null (shared) staff at their branches.',
    })
    list(@CurrentUser() user: HrUser, @Query() query: EmployeeQueryDto) {
        return this.employees.list(user, query);
    }

    @Get(':id')
    @RequirePermission(Permissions.EMPLOYEES_VIEW)
    @ApiOperation({
        summary: 'Employee 360',
        description:
            'Profile, current assignment, full assignment history, timeline, documents and warnings. Bank details are omitted unless the caller holds salary:view.',
    })
    findOne(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.employees.findOne(user, id);
    }

    @Post()
    @RequirePermission(Permissions.EMPLOYEES_CREATE)
    @ApiOperation({
        summary: 'Create an employee and their hire assignment',
        description:
            'Both are written in one transaction — an employee with no assignment would be invisible to every scoped query.',
    })
    create(@CurrentUser() user: HrUser, @Body() dto: CreateEmployeeDto) {
        return this.employees.create(user, dto);
    }

    @Put(':id')
    @RequirePermission(Permissions.EMPLOYEES_EDIT)
    @ApiOperation({
        summary: 'Update personal details',
        description:
            'Branch, brand and designation are NOT editable here — those changes are transfers or promotions and must leave a dated assignment row. Use POST /:id/assignment.',
    })
    update(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: UpdateEmployeeDto,
    ) {
        return this.employees.update(user, id, dto);
    }

    @Post(':id/assignment')
    @RequirePermission(Permissions.EMPLOYEES_EDIT)
    @ApiOperation({
        summary: 'Promote, demote, transfer or confirm',
        description:
            'Closes the current assignment the day before effective_from and opens a new one, in one transaction.',
    })
    changeAssignment(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: ChangeAssignmentDto,
    ) {
        return this.employees.changeAssignment(user, id, dto);
    }

    @Post(':id/documents')
    @RequirePermission(Permissions.EMPLOYEE_DOCS_MANAGE)
    addDocument(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: EmployeeDocumentDto,
    ) {
        return this.employees.addDocument(user, id, dto);
    }

    @Delete(':id/documents/:documentId')
    @RequirePermission(Permissions.EMPLOYEE_DOCS_MANAGE)
    removeDocument(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
        @Param('documentId', ParseIntPipe) documentId: number,
    ) {
        return this.employees.removeDocument(user, id, documentId);
    }

    @Post(':id/warnings')
    @RequirePermission(Permissions.EMPLOYEES_EDIT)
    addWarning(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: EmployeeWarningDto,
    ) {
        return this.employees.addWarning(user, id, dto);
    }

    // ------------------------------------------------------------------ exit

    @Get(':id/exit')
    @RequirePermission(Permissions.EMPLOYEES_VIEW)
    getExit(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
    ) {
        return this.exits.findForEmployee(user, id);
    }

    @Post(':id/exit')
    @RequirePermission(Permissions.EMPLOYEES_TERMINATE)
    @ApiOperation({
        summary: 'Record a resignation or termination',
        description:
            'Closes the current assignment on the last working day, revokes attendance credentials, and creates the clearance checklist. Final settlement arrives with payroll in Phase 4.',
    })
    recordExit(
        @CurrentUser() user: HrUser,
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: RecordExitDto,
    ) {
        return this.exits.record(user, id, dto);
    }
}

@ApiTags('Admin – Employee HRM')
@ApiBearerAuth()
@Controller('admin/hr/exits')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class EmployeeExitsController {
    constructor(private readonly exits: EmployeeExitsService) {}

    @Patch(':exitId/clearance/:itemId')
    @RequirePermission(Permissions.EMPLOYEES_TERMINATE)
    @ApiOperation({
        summary: 'Tick off a clearance item',
        description:
            'The exit’s overall clearance status is rolled up from its items, so the list and the checklist can never disagree.',
    })
    updateClearance(
        @CurrentUser() user: HrUser,
        @Param('exitId', ParseIntPipe) exitId: number,
        @Param('itemId', ParseIntPipe) itemId: number,
        @Body() dto: UpdateClearanceItemDto,
    ) {
        return this.exits.updateClearanceItem(user, exitId, itemId, dto);
    }
}

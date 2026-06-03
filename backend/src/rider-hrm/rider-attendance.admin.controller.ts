import {
    BadRequestException,
    Body,
    Controller,
    Post,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { RiderHrmService } from './rider-hrm.service';

@ApiTags('Admin – Rider HRM – Attendance')
@ApiBearerAuth()
@Controller('admin/rider-hrm')
@UseGuards(JwtAuthGuard, RoleAccessGuard)
export class RiderAttendanceAdminController {
    constructor(private readonly riderHrmService: RiderHrmService) {}

    @Post('attendance/check-in')
    checkIn(
        @Body()
        body: {
            rider_user_id: number;
            branch_id: number;
            notes?: string;
        },
    ) {
        if (
            body?.rider_user_id == null ||
            body?.branch_id == null ||
            typeof body.rider_user_id !== 'number' ||
            typeof body.branch_id !== 'number'
        ) {
            throw new BadRequestException(
                'rider_user_id and branch_id are required',
            );
        }
        return this.riderHrmService.checkIn(
            body.rider_user_id,
            body.branch_id,
            body.notes,
        );
    }

    @Post('attendance/check-out')
    checkOut(@Body() body: { rider_user_id: number; notes?: string }) {
        if (
            body?.rider_user_id == null ||
            typeof body.rider_user_id !== 'number'
        ) {
            throw new BadRequestException('rider_user_id is required');
        }
        return this.riderHrmService.checkOut(body.rider_user_id, body.notes);
    }
}

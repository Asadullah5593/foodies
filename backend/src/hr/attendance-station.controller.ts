import {
    BadRequestException,
    Logger,
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseIntPipe,
    Post,
    Req,
    UploadedFile,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express/multer/interceptors/file.interceptor';
import { MediaStorageService } from '../media/media-storage.service';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleAccessGuard } from '../auth/role-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../roles/require-permission.decorator';
import { RequirePermissionGuard } from '../roles/require-permission.guard';
import { Permissions } from '../roles/permissions.dto';
import { AttendanceService } from './attendance.service';
import { StationAuthGuard } from './station-auth.guard';
import type { StationRequest } from './station-auth.guard';
import type { HrUser } from './employee-scope';
import { StationPunchDto, CreateStationDto } from './dto/attendance.dto';

/**
 * The unauthenticated station surface.
 *
 * No JWT: a device token in `x-station-token` identifies the tablet, and the
 * employee still proves themselves with their own code + PIN or QR card. This
 * exists because staff have no user accounts, and requiring a manager to stay
 * signed in all day leaves an authenticated admin session on a shared screen.
 *
 * The token authorises exactly one action — recording a punch at its own branch.
 * It reads no roster, no salaries, nothing.
 */
@ApiTags('Attendance Station (device token)')
@Controller('attendance-station')
@UseGuards(StationAuthGuard)
export class PublicAttendanceStationController {
    private readonly logger = new Logger(
        PublicAttendanceStationController.name,
    );

    constructor(
        private readonly attendance: AttendanceService,
        private readonly mediaStorage: MediaStorageService,
    ) {}

    @Get('context')
    @ApiOperation({
        summary: 'Validate the device token and describe the station',
        description:
            'Returns the branch this device belongs to and its capture policy, so the screen can label itself and know whether a photo is required.',
    })
    context(@Req() request: StationRequest) {
        return this.attendance.stationContext(request.station!);
    }

    @Post('punch')
    @ApiOperation({
        summary: 'Clock in or out from a registered device',
        description:
            'Identity is the employee’s own code + PIN, or a scanned QR card. The branch comes from the device token — it is never sent by the client — and the timestamp is the server’s.',
    })
    punch(@Req() request: StationRequest, @Body() dto: StationPunchDto) {
        return this.attendance.stationPunch(request.station!, dto);
    }

    /**
     * Punch photo upload for an unauthenticated station.
     *
     * The shared /upload endpoint needs a JWT, which a station does not have.
     * Rather than widen that endpoint's auth, the station gets its own — locked
     * to the `attendance` folder, so a device token cannot be used to write
     * images anywhere else.
     */
    @Post('photo')
    @UseInterceptors(FileInterceptor('file'))
    @ApiOperation({ summary: 'Upload a punch photo from a registered device' })
    async photo(
        @UploadedFile()
        file: {
            originalname?: string;
            mimetype?: string;
            buffer?: Buffer;
        },
    ) {
        if (!file?.buffer) throw new BadRequestException('No file uploaded');
        if (!/^image\/(png|jpeg|jpg|webp)$/i.test(file.mimetype || '')) {
            throw new BadRequestException('Only image files are allowed');
        }
        try {
            const result = await this.mediaStorage.uploadImage(
                file,
                'attendance',
            );
            return { url: result.url };
        } catch (e) {
            // A half-written frame from a flaky webcam is a bad request, not a
            // server fault — and the station shows this message on screen, so
            // it has to say something a manager can act on.
            this.logger.warn(
                `Punch photo rejected: ${e instanceof Error ? e.message : String(e)}`,
            );
            throw new BadRequestException(
                'That image could not be processed — the punch was still recorded',
            );
        }
    }
}

/** Admin management of the devices. Requires a real login. */
@ApiTags('Admin – Attendance')
@ApiBearerAuth()
@Controller('admin/hr/attendance-stations')
@UseGuards(JwtAuthGuard, RoleAccessGuard, RequirePermissionGuard)
export class AttendanceStationAdminController {
    constructor(private readonly attendance: AttendanceService) {}

    @Get()
    @RequirePermission(Permissions.ATTENDANCE_STATIONS_MANAGE)
    list(@CurrentUser() user: HrUser) {
        return this.attendance.listStations(user);
    }

    @Post()
    @RequirePermission(Permissions.ATTENDANCE_STATIONS_MANAGE)
    @ApiOperation({
        summary: 'Register a device',
        description:
            'Returns the token to paste into the station screen once. It stays readable afterwards so a replacement device can be set up without re-registering.',
    })
    create(@CurrentUser() user: HrUser, @Body() dto: CreateStationDto) {
        return this.attendance.createStation(user, dto);
    }

    @Delete(':id')
    @RequirePermission(Permissions.ATTENDANCE_STATIONS_MANAGE)
    @ApiOperation({
        summary: 'Revoke a device',
        description: 'Its stored token stops working immediately.',
    })
    revoke(@CurrentUser() user: HrUser, @Param('id', ParseIntPipe) id: number) {
        return this.attendance.revokeStation(user, id);
    }
}

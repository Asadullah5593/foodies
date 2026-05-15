import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    IsBoolean,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    Max,
    Min,
} from 'class-validator';

/** POST /api/rider/attendance/check-in — body (JSON). */
export class RiderCheckInDto {
    @ApiProperty({
        example: 10,
        description:
            'Branch ID. Must be a branch where this user is assigned with the `rider` role.',
    })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    branch_id: number;

    @ApiPropertyOptional({
        example: 'Opening shift',
        description: 'Optional note stored on the attendance session.',
    })
    @IsOptional()
    @IsString()
    notes?: string;
}

/** POST /api/rider/attendance/check-out — body (JSON). Empty object `{}` is valid. */
export class RiderCheckOutDto {
    @ApiPropertyOptional({
        example: 'End of shift',
        description: 'Optional note stored when checking out.',
    })
    @IsOptional()
    @IsString()
    notes?: string;
}

/**
 * PATCH /api/rider/attendance/pause — body (JSON).
 * `is_paused: true` = start break (rider unavailable for dispatch).
 * `is_paused: false` = end break (resume availability).
 */
export class RiderPauseDto {
    @ApiProperty({
        example: true,
        description:
            'Required. `true` to start break, `false` to end break. Rider must already be checked in.',
    })
    @IsBoolean()
    is_paused: boolean;

    @ApiPropertyOptional({
        example: 'Lunch',
        description:
            'Optional human-readable reason when starting a break. If omitted when pausing, server may default to a generic label.',
    })
    @IsOptional()
    @IsString()
    pause_reason?: string;
}

/** PATCH /api/rider/attendance/heartbeat — body (JSON). Coordinates optional but recommended for dispatch eligibility. */
export class RiderHeartbeatDto {
    @ApiPropertyOptional({
        example: 31.4522,
        description:
            'WGS84 latitude (-90..90). When sent with longitude, updates last known rider location.',
    })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(-90)
    @Max(90)
    latitude?: number;

    @ApiPropertyOptional({
        example: 74.2759,
        description:
            'WGS84 longitude (-180..180). When sent with latitude, updates last known rider location.',
    })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(-180)
    @Max(180)
    longitude?: number;
}

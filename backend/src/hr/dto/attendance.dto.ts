import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    IsBoolean,
    IsDateString,
    IsEnum,
    IsInt,
    IsOptional,
    IsString,
    Length,
    MaxLength,
    Min,
} from 'class-validator';

export const PUNCH_TYPES = ['in', 'out', 'break_start', 'break_end'] as const;

/**
 * POST /api/admin/hr/attendance/punch
 *
 * Note what is NOT here: no timestamp. The server stamps it, because a station
 * that accepts a client clock accepts any clock.
 */
export class PunchDto {
    @ApiProperty({ example: 10 })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    branch_id: number;

    @ApiProperty({ enum: PUNCH_TYPES })
    @IsEnum(PUNCH_TYPES)
    punch_type: (typeof PUNCH_TYPES)[number];

    @ApiPropertyOptional({ example: 'EMP-0007', description: 'With `pin`.' })
    @IsOptional()
    @IsString()
    @Length(1, 32)
    employee_code?: string;

    @ApiPropertyOptional({ example: '482913' })
    @IsOptional()
    @IsString()
    @Length(4, 8)
    pin?: string;

    @ApiPropertyOptional({
        description: 'Scanned employee card. Used instead of code + PIN.',
    })
    @IsOptional()
    @IsString()
    qr_token?: string;

    @ApiPropertyOptional({
        description:
            'S3 URL of the capture. Required to clock in where the branch policy sets require_photo.',
    })
    @IsOptional()
    @IsString()
    photo_url?: string;
}

/**
 * POST /api/attendance-station/punch
 *
 * Same as PunchDto minus `branch_id`: the branch comes from the device token, so
 * a station cannot record a punch at someone else's branch by asking.
 */
export class StationPunchDto {
    @ApiProperty({ enum: PUNCH_TYPES })
    @IsEnum(PUNCH_TYPES)
    punch_type: (typeof PUNCH_TYPES)[number];

    @ApiPropertyOptional({ example: 'EMP-0007' })
    @IsOptional()
    @IsString()
    @Length(1, 32)
    employee_code?: string;

    @ApiPropertyOptional({ example: '482913' })
    @IsOptional()
    @IsString()
    @Length(4, 8)
    pin?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    qr_token?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    photo_url?: string;
}

/** POST /api/admin/hr/attendance-stations */
export class CreateStationDto {
    @ApiProperty({ example: 10 })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    branch_id: number;

    @ApiProperty({ example: 'Staff entrance tablet' })
    @IsString()
    @Length(2, 120)
    label: string;
}

/** POST /api/admin/hr/attendance/attest — supervisor roll call. */
export class ManagerAttestDto {
    @ApiProperty({ example: 10 })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    branch_id: number;

    @ApiProperty({ example: 7 })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    employee_id: number;

    @ApiProperty({ enum: PUNCH_TYPES })
    @IsEnum(PUNCH_TYPES)
    punch_type: (typeof PUNCH_TYPES)[number];

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    note?: string;
}

/** PUT /api/admin/hr/employees/:id/pin */
export class SetPinDto {
    @ApiProperty({ example: '482913', description: '4–8 digits.' })
    @IsString()
    @Length(4, 8)
    pin: string;
}

/** GET /api/admin/hr/attendance/register */
export class RegisterQueryDto {
    @ApiPropertyOptional()
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    branch_id?: number;

    @ApiProperty({ example: '2026-08-11' })
    @IsDateString()
    date_from: string;

    @ApiProperty({ example: '2026-08-17' })
    @IsDateString()
    date_to: string;
}

/**
 * POST /api/admin/hr/attendance/days/:id/exceptions
 *
 * `reason` is required on every kind, and the DB enforces non-empty too — an
 * unexplained waiver is precisely what this record exists to prevent.
 */
export class CreateExceptionDto {
    @ApiProperty({ enum: ['adjustment', 'waiver', 'overtime_approval'] })
    @IsEnum(['adjustment', 'waiver', 'overtime_approval'])
    kind: 'adjustment' | 'waiver' | 'overtime_approval';

    @ApiProperty({
        enum: [
            'missed_punch',
            'wrong_time',
            'status_override',
            'late',
            'half_day',
            'absent',
            'early_leave',
            'overtime',
        ],
    })
    @IsEnum([
        'missed_punch',
        'wrong_time',
        'status_override',
        'late',
        'half_day',
        'absent',
        'early_leave',
        'overtime',
    ])
    subject: string;

    @ApiProperty({ example: 'Bike breakdown, verified with workshop receipt' })
    @IsString()
    @Length(3, 2000)
    reason: string;

    @ApiPropertyOptional({
        description:
            'For adjustments: the corrected values, e.g. { "last_out_at": "2026-08-17T21:00:00Z" }.',
    })
    @IsOptional()
    new_value?: Record<string, unknown>;

    @ApiPropertyOptional({ description: 'For waivers: minutes forgiven.' })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    minutes_waived?: number;
}

/**
 * PATCH /api/admin/hr/attendance/days/:id/times
 *
 * Corrects what the day SAYS, not what was punched. Punches stay immutable and
 * the change is recorded as an approved adjustment with this reason.
 */
export class CorrectDayTimesDto {
    @ApiPropertyOptional({ example: '2026-08-17T06:00:00.000Z' })
    @IsOptional()
    @IsDateString()
    first_in_at?: string;

    @ApiPropertyOptional({ example: '2026-08-17T15:00:00.000Z' })
    @IsOptional()
    @IsDateString()
    last_out_at?: string;

    @ApiProperty({
        example: 'Forgot to clock out; verified with the branch manager',
    })
    @IsString()
    @Length(3, 2000)
    reason: string;
}

/** PATCH /api/admin/hr/attendance/exceptions/:id */
export class DecideExceptionDto {
    @ApiProperty({ enum: ['approved', 'rejected'] })
    @IsEnum(['approved', 'rejected'])
    decision: 'approved' | 'rejected';
}

/** POST /api/admin/hr/attendance/days/:id/overtime */
export class DecideOvertimeDto {
    @ApiProperty({ example: true, description: 'False rejects it.' })
    @IsBoolean()
    approve: boolean;

    @ApiPropertyOptional({
        description:
            'Approve fewer minutes than were earned. Never more — the ceiling is what the day actually accrued.',
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    minutes?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(2000)
    reason?: string;
}

/** POST /api/admin/hr/attendance/overtime/decide-all */
export class DecideOvertimeBulkDto {
    @ApiProperty({ example: '2026-08-01' })
    @IsDateString()
    date_from: string;

    @ApiProperty({ example: '2026-08-31' })
    @IsDateString()
    date_to: string;

    @ApiPropertyOptional()
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    branch_id?: number;

    @ApiProperty({ example: true })
    @IsBoolean()
    approve: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(2000)
    reason?: string;
}

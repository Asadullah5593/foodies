import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    IsBoolean,
    IsDateString,
    IsEnum,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    Length,
    Min,
} from 'class-validator';

export const DAY_PARTS = ['full', 'first_half', 'second_half'] as const;

/** POST /api/admin/hr/leaves */
export class CreateLeaveRequestDto {
    @ApiProperty({ example: 7 })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    employee_id: number;

    @ApiProperty({ example: 2 })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    leave_type_id: number;

    @ApiProperty({ example: '2026-09-01' })
    @IsDateString()
    from_date: string;

    @ApiProperty({ example: '2026-09-03' })
    @IsDateString()
    to_date: string;

    @ApiPropertyOptional({ enum: DAY_PARTS, default: 'full' })
    @IsOptional()
    @IsEnum(DAY_PARTS)
    first_day_part?: (typeof DAY_PARTS)[number];

    @ApiPropertyOptional({ enum: DAY_PARTS, default: 'full' })
    @IsOptional()
    @IsEnum(DAY_PARTS)
    last_day_part?: (typeof DAY_PARTS)[number];

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @Length(0, 2000)
    reason?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    attachment_url?: string;
}

/** PATCH /api/admin/hr/leaves/:id */
export class DecideLeaveDto {
    @ApiProperty({ enum: ['approved', 'rejected', 'cancelled'] })
    @IsEnum(['approved', 'rejected', 'cancelled'])
    decision: 'approved' | 'rejected' | 'cancelled';

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    note?: string;
}

/** POST / PUT /api/admin/hr/settings/leave-types */
export class LeaveTypeDto {
    @ApiProperty({ example: 'Casual Leave' })
    @IsString()
    @Length(2, 120)
    name: string;

    @ApiPropertyOptional({ example: 'casual' })
    @IsOptional()
    @IsString()
    @Length(2, 48)
    code?: string;

    @ApiPropertyOptional({ default: true })
    @IsOptional()
    @IsBoolean()
    is_paid?: boolean;

    @ApiPropertyOptional({ enum: ['monthly', 'annual', 'none'] })
    @IsOptional()
    @IsEnum(['monthly', 'annual', 'none'])
    accrual_mode?: 'monthly' | 'annual' | 'none';

    @ApiPropertyOptional({ example: 1 })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    quota_per_period?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    carry_forward?: boolean;

    @ApiPropertyOptional({
        description:
            'Unused entitlement is paid out. True for the monthly-off type by client policy.',
    })
    @IsOptional()
    @IsBoolean()
    encash_unused?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    requires_document?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    is_active?: boolean;
}

/** POST /api/admin/hr/settings/public-holidays */
export class PublicHolidayDto {
    @ApiProperty({ example: '2026-08-14' })
    @IsDateString()
    holiday_date: string;

    @ApiProperty({ example: 'Independence Day' })
    @IsString()
    @Length(2, 160)
    name: string;

    @ApiPropertyOptional({
        description: 'Omit for every branch.',
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    branch_id?: number;

    @ApiPropertyOptional({ default: true })
    @IsOptional()
    @IsBoolean()
    is_paid?: boolean;
}

/** GET /api/admin/hr/leaves */
export class LeaveQueryDto {
    @ApiPropertyOptional()
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    employee_id?: number;

    @ApiPropertyOptional({
        enum: ['pending', 'approved', 'rejected', 'cancelled'],
    })
    @IsOptional()
    @IsEnum(['pending', 'approved', 'rejected', 'cancelled'])
    status?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsDateString()
    date_from?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsDateString()
    date_to?: string;
}

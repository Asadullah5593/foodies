import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    IsBoolean,
    IsDateString,
    IsEnum,
    IsInt,
    IsNumber,
    IsObject,
    IsOptional,
    IsString,
    Length,
    Matches,
    Max,
    Min,
} from 'class-validator';

const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/** POST /api/admin/hr/settings/schedule-templates */
export class ScheduleTemplateDto {
    @ApiPropertyOptional({ description: 'Omit to create.' })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    id?: number;

    @ApiPropertyOptional({ description: 'Null applies tenant-wide.' })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    branchId?: number | null;

    @ApiPropertyOptional()
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    designationId?: number | null;

    @ApiProperty({ example: 'Morning 11:00–20:00' })
    @IsString()
    @Length(2, 120)
    name: string;

    @ApiProperty({ example: '11:00', description: 'Branch-local HH:mm.' })
    @Matches(TIME, { message: 'startTime must be HH:mm' })
    startTime: string;

    @ApiProperty({ example: '20:00' })
    @Matches(TIME, { message: 'endTime must be HH:mm' })
    endTime: string;

    @ApiPropertyOptional({ example: 60 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    breakMinutes?: number;

    @ApiPropertyOptional({ example: 15, description: 'Lateness grace.' })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    graceMinutes?: number;

    @ApiPropertyOptional({
        example: 120,
        description:
            'Beyond this many minutes late the day is a half day regardless of hours worked. Null disables it.',
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    halfDayAfterLateMinutes?: number | null;

    @ApiPropertyOptional({ example: 480 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    minMinutesFullDay?: number;

    @ApiPropertyOptional({ example: 270 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    minMinutesHalfDay?: number;

    @ApiPropertyOptional({ example: 30 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    overtimeAfterMinutes?: number;

    @ApiPropertyOptional({
        example: 6,
        description: 'Hours before the shift a punch still counts.',
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    @Max(23)
    attributionLeadHours?: number;

    @ApiPropertyOptional({ example: 6 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    @Max(23)
    attributionTrailHours?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    isDefault?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}

export const CAPTURE_METHODS = ['pin', 'qr', 'photo', 'attestation'] as const;

/** POST /api/admin/hr/settings/capture-policies */
export class CapturePolicyDto {
    @ApiPropertyOptional()
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    id?: number;

    @ApiPropertyOptional({ description: 'Null is the tenant default.' })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    branchId?: number | null;

    @ApiProperty({ enum: CAPTURE_METHODS })
    @IsEnum(CAPTURE_METHODS)
    primaryMethod: (typeof CAPTURE_METHODS)[number];

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    requirePhoto?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    allowManagerAttestation?: boolean;

    @ApiPropertyOptional({
        example: 60,
        description: 'Repeat punches inside this window are rejected.',
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    duplicateWindowSeconds?: number;

    @ApiPropertyOptional({ example: 90 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    photoRetentionDays?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}

export const OT_RATE_TYPES = ['multiplier_of_hourly', 'flat_per_hour'] as const;

/** POST /api/admin/hr/settings/overtime-policies */
export class OvertimePolicyDto {
    @ApiPropertyOptional()
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    id?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    branchId?: number | null;

    @ApiPropertyOptional()
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    designationId?: number | null;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    isEnabled?: boolean;

    @ApiPropertyOptional({ example: 30 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    minMinutesToQualify?: number;

    @ApiPropertyOptional({ example: 15 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    roundingMinutes?: number;

    @ApiPropertyOptional({ enum: OT_RATE_TYPES })
    @IsOptional()
    @IsEnum(OT_RATE_TYPES)
    rateType?: (typeof OT_RATE_TYPES)[number];

    @ApiPropertyOptional({ example: 1.5 })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    rateValue?: number;

    @ApiPropertyOptional({ example: 2 })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    weeklyOffMultiplier?: number;

    @ApiPropertyOptional({ example: 2 })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    holidayMultiplier?: number;

    @ApiPropertyOptional({ example: 240 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    dailyCapMinutes?: number | null;

    @ApiPropertyOptional()
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    monthlyCapMinutes?: number | null;

    @ApiPropertyOptional({
        description: 'Overtime accrues as pending until confirmed.',
    })
    @IsOptional()
    @IsBoolean()
    requiresApproval?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsDateString()
    effectiveFrom?: string | null;

    @ApiPropertyOptional()
    @IsOptional()
    @IsDateString()
    effectiveTo?: string | null;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}

export const OFF_SELECTION = ['floating', 'fixed_weekday'] as const;
export const BEYOND_QUOTA = ['unpaid', 'refuse'] as const;

/** POST /api/admin/hr/settings/offs-policies */
export class HolidayPolicyDto {
    @ApiPropertyOptional()
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    id?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    branchId?: number | null;

    @ApiPropertyOptional()
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    designationId?: number | null;

    @ApiPropertyOptional({ example: 4 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    @Max(31)
    offsPerMonth?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    offsArePaid?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    carryForward?: boolean;

    @ApiPropertyOptional({
        description: 'Unused offs paid out at the daily rate.',
    })
    @IsOptional()
    @IsBoolean()
    encashUnused?: boolean;

    @ApiPropertyOptional({ enum: OFF_SELECTION })
    @IsOptional()
    @IsEnum(OFF_SELECTION)
    offSelection?: (typeof OFF_SELECTION)[number];

    @ApiPropertyOptional({ enum: BEYOND_QUOTA })
    @IsOptional()
    @IsEnum(BEYOND_QUOTA)
    beyondQuotaTreatment?: (typeof BEYOND_QUOTA)[number];

    @ApiPropertyOptional()
    @IsOptional()
    @IsDateString()
    effectiveFrom?: string | null;

    @ApiPropertyOptional()
    @IsOptional()
    @IsDateString()
    effectiveTo?: string | null;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}

/** POST /api/admin/hr/settings/leave-types */
export class LeaveTypeDto {
    @ApiPropertyOptional()
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    id?: number;

    @ApiProperty({ example: 'Monthly off' })
    @IsString()
    @Length(2, 120)
    name: string;

    @ApiPropertyOptional({ description: 'Derived from the name when omitted.' })
    @IsOptional()
    @IsString()
    @Length(2, 48)
    code?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    isPaid?: boolean;

    @ApiPropertyOptional({ example: 4 })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    quotaPerPeriod?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    carryForward?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    encashUnused?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    maxConsecutiveDays?: number | null;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    requiresDocument?: boolean;

    @ApiPropertyOptional({
        description:
            'The 4-offs entitlement is computed from exactly one type. Fixed once created.',
    })
    @IsOptional()
    @IsBoolean()
    isMonthlyOff?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    sortOrder?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}

export const DEDUCTION_TRIGGERS = [
    'late',
    'absent',
    'half_day',
    'early_leave',
    'missed_punch',
    'unapproved_leave',
] as const;

export const DEDUCTION_EFFECTS = [
    'deduct_days',
    'deduct_amount',
    'deduct_percent_of_daily',
] as const;

/** POST /api/admin/hr/settings/deduction-rules */
export class DeductionRuleDto {
    @ApiPropertyOptional()
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    id?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    branchId?: number | null;

    @ApiPropertyOptional()
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    designationId?: number | null;

    @ApiProperty({ enum: DEDUCTION_TRIGGERS })
    @IsEnum(DEDUCTION_TRIGGERS)
    trigger: (typeof DEDUCTION_TRIGGERS)[number];

    @ApiPropertyOptional({
        example: { ladder: [0, 0.5, 0.5] },
        description:
            'A `late` rule carries `{ ladder }` — days deducted at each position, repeating.',
    })
    @IsOptional()
    @IsObject()
    condition?: Record<string, unknown>;

    @ApiProperty({ enum: DEDUCTION_EFFECTS })
    @IsEnum(DEDUCTION_EFFECTS)
    effectType: (typeof DEDUCTION_EFFECTS)[number];

    @ApiPropertyOptional({ example: 1 })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    effectValue?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    priority?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsDateString()
    effectiveFrom?: string | null;

    @ApiPropertyOptional()
    @IsOptional()
    @IsDateString()
    effectiveTo?: string | null;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}

export const APPROVAL_SUBJECTS = [
    'attendance_waiver',
    'leave_request',
    'overtime',
    'payroll_run',
    'salary_change',
    'promotion',
    'payroll_adjustment',
] as const;

/** POST /api/admin/hr/settings/approval-rules */
export class ApprovalRuleDto {
    @ApiPropertyOptional()
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    id?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    branchId?: number | null;

    @ApiProperty({ enum: APPROVAL_SUBJECTS })
    @IsEnum(APPROVAL_SUBJECTS)
    subject: (typeof APPROVAL_SUBJECTS)[number];

    @ApiPropertyOptional({
        example: { amountGt: 2000 },
        description:
            'Thresholds: amountGt, daysGt, minutesGt. All must hold; `{}` matches everything.',
    })
    @IsOptional()
    @IsObject()
    condition?: Record<string, unknown>;

    @ApiProperty({ example: 'all-branches:access' })
    @IsString()
    @Length(2, 120)
    requiredPermission: string;

    @ApiPropertyOptional({
        description: 'Named in the refusal so the message says who can.',
    })
    @IsOptional()
    @IsString()
    @Length(2, 120)
    escalateToPermission?: string | null;

    @ApiPropertyOptional()
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    priority?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}

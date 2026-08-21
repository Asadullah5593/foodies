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

export const EMPLOYMENT_TYPES = [
    'full_time',
    'part_time',
    'contract',
    'probation',
] as const;

export const EMPLOYEE_STATUSES = [
    'active',
    'on_leave',
    'suspended',
    'notice_period',
    'resigned',
    'terminated',
] as const;

export const ASSIGNMENT_CHANGE_REASONS = [
    'promotion',
    'demotion',
    'transfer_branch',
    'transfer_brand',
    'designation_change',
    'confirmation',
] as const;

/** POST /api/admin/hr/employees */
export class CreateEmployeeDto {
    @ApiPropertyOptional({
        example: 'EMP-0007',
        description:
            'Unique per tenant. Typed by the employee at the attendance station. Auto-generated when omitted.',
    })
    @IsOptional()
    @IsString()
    @Length(1, 32)
    employee_code?: string;

    @ApiProperty({ example: 'Bilal Ahmed' })
    @IsString()
    @Length(2, 160)
    full_name: string;

    @ApiPropertyOptional({ example: 'Ahmed Raza' })
    @IsOptional()
    @IsString()
    @MaxLength(160)
    father_name?: string;

    @ApiPropertyOptional({ example: '35202-1234567-1' })
    @IsOptional()
    @IsString()
    @MaxLength(32)
    cnic?: string;

    @ApiPropertyOptional({ example: '1998-04-12' })
    @IsOptional()
    @IsDateString()
    date_of_birth?: string;

    @ApiPropertyOptional({ example: 'male' })
    @IsOptional()
    @IsString()
    @MaxLength(16)
    gender?: string;

    @ApiPropertyOptional({ example: '03001234567' })
    @IsOptional()
    @IsString()
    @MaxLength(32)
    phone?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    address?: string;

    @ApiPropertyOptional({ example: 'Sadia Ahmed' })
    @IsOptional()
    @IsString()
    @MaxLength(160)
    emergency_contact_name?: string;

    @ApiPropertyOptional({ example: '03007654321' })
    @IsOptional()
    @IsString()
    @MaxLength(32)
    emergency_contact_phone?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    photo_url?: string;

    @ApiPropertyOptional({
        example: 42,
        description:
            'Link to an existing login. Most employees have none — leave null.',
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    user_id?: number;

    // --- first assignment (created atomically with the employee) ------------

    @ApiProperty({
        example: 10,
        description: 'Branch the employee is hired at.',
    })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    branch_id: number;

    @ApiPropertyOptional({
        example: 25,
        description:
            'Brand the employee works for. Omit for shared branch staff (cleaners, security) — they stay visible to every manager at the branch.',
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    brand_id?: number;

    @ApiProperty({ example: 3 })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    designation_id: number;

    @ApiPropertyOptional({ enum: EMPLOYMENT_TYPES, default: 'full_time' })
    @IsOptional()
    @IsEnum(EMPLOYMENT_TYPES)
    employment_type?: (typeof EMPLOYMENT_TYPES)[number];

    @ApiProperty({ example: '2026-08-17' })
    @IsDateString()
    date_of_joining: string;

    @ApiPropertyOptional({ example: '2026-11-17' })
    @IsOptional()
    @IsDateString()
    probation_end_date?: string;

    // --- payment details (gated by salary:view on read) ---------------------

    @ApiPropertyOptional({ example: 'Meezan Bank' })
    @IsOptional()
    @IsString()
    @MaxLength(120)
    bank_name?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(160)
    account_title?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(64)
    account_number_iban?: string;

    @ApiPropertyOptional({ enum: ['cash', 'bank_transfer'], default: 'cash' })
    @IsOptional()
    @IsEnum(['cash', 'bank_transfer'])
    payment_method?: 'cash' | 'bank_transfer';
}

/**
 * PUT /api/admin/hr/employees/:id — personal details only.
 *
 * Branch, brand and designation are deliberately absent: changing those is a
 * transfer or a promotion, which must leave a dated assignment row. Use
 * POST /employees/:id/assignment.
 */
export class UpdateEmployeeDto {
    @ApiPropertyOptional({
        example: 'EMP-0007',
        description:
            'Editable — the code staff type at the attendance station, so admins need to be able to correct it. Still unique per tenant.',
    })
    @IsOptional()
    @IsString()
    @Length(1, 32)
    employee_code?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @Length(2, 160)
    full_name?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(160)
    father_name?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(32)
    cnic?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsDateString()
    date_of_birth?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(16)
    gender?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(32)
    phone?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    address?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(160)
    emergency_contact_name?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(32)
    emergency_contact_phone?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    photo_url?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    user_id?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsDateString()
    probation_end_date?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsDateString()
    confirmation_date?: string;

    @ApiPropertyOptional({ enum: ['active', 'on_leave', 'suspended'] })
    @IsOptional()
    @IsEnum(['active', 'on_leave', 'suspended'])
    status?: 'active' | 'on_leave' | 'suspended';

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(120)
    bank_name?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(160)
    account_title?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(64)
    account_number_iban?: string;

    @ApiPropertyOptional({ enum: ['cash', 'bank_transfer'] })
    @IsOptional()
    @IsEnum(['cash', 'bank_transfer'])
    payment_method?: 'cash' | 'bank_transfer';
}

/**
 * POST /api/admin/hr/employees/:id/assignment — promotion, demotion, transfer
 * or confirmation. Closes the current assignment and opens a new one.
 */
export class ChangeAssignmentDto {
    @ApiProperty({ enum: ASSIGNMENT_CHANGE_REASONS })
    @IsEnum(ASSIGNMENT_CHANGE_REASONS)
    change_reason: (typeof ASSIGNMENT_CHANGE_REASONS)[number];

    @ApiProperty({
        example: '2026-09-01',
        description:
            'First day under the new assignment. The previous assignment is closed the day before.',
    })
    @IsDateString()
    effective_from: string;

    @ApiPropertyOptional({ description: 'Defaults to the current branch.' })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    branch_id?: number;

    @ApiPropertyOptional({
        description:
            'Defaults to the current brand. Send null explicitly to move someone to shared branch staff.',
        nullable: true,
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    brand_id?: number | null;

    @ApiPropertyOptional({
        description: 'Defaults to the current designation.',
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    designation_id?: number;

    @ApiPropertyOptional({ enum: EMPLOYMENT_TYPES })
    @IsOptional()
    @IsEnum(EMPLOYMENT_TYPES)
    employment_type?: (typeof EMPLOYMENT_TYPES)[number];

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    note?: string;
}

/** GET /api/admin/hr/employees — query string. */
export class EmployeeQueryDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    search?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    branch_id?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    brand_id?: number;

    @ApiPropertyOptional({
        description:
            'Only staff with NO brand — cleaners, guards, anyone shared across brands. `brand_id` cannot express this, since the column is null.',
    })
    @IsOptional()
    @IsBoolean()
    @Type(() => Boolean)
    unassigned_brand?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    designation_id?: number;

    @ApiPropertyOptional({ enum: EMPLOYEE_STATUSES })
    @IsOptional()
    @IsEnum(EMPLOYEE_STATUSES)
    status?: (typeof EMPLOYEE_STATUSES)[number];

    @ApiPropertyOptional({
        description:
            'Include employees who have left. Off by default so the roster shows current staff.',
    })
    @IsOptional()
    @IsBoolean()
    @Type(() => Boolean)
    include_inactive?: boolean;

    @ApiPropertyOptional({ default: 1 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number;

    @ApiPropertyOptional({ default: 25 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    limit?: number;
}

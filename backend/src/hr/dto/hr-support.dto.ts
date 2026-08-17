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

export const DEPARTMENTS = [
    'kitchen',
    'front_of_house',
    'delivery',
    'management',
    'support',
] as const;

export const EXIT_TYPES = [
    'resignation',
    'termination',
    'end_of_contract',
    'abandonment',
] as const;

export const CLEARANCE_ITEM_TYPES = [
    'uniform',
    'keys',
    'pos_access',
    'cash_handover',
    'equipment',
    'outstanding_advance',
    'other',
] as const;

/** POST / PUT /api/admin/hr/settings/designations */
export class DesignationDto {
    @ApiProperty({ example: 'Head Chef' })
    @IsString()
    @Length(2, 120)
    name: string;

    @ApiPropertyOptional({
        example: 50,
        description:
            'Promotion ladder position. Higher = more senior; a promotion must move up.',
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    level?: number;

    @ApiPropertyOptional({ enum: DEPARTMENTS, default: 'support' })
    @IsOptional()
    @IsEnum(DEPARTMENTS)
    department?: (typeof DEPARTMENTS)[number];

    @ApiPropertyOptional({
        description:
            'RBAC role implied for staff who log in. Optional — a designation is a job title, not a permission set.',
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    default_role_id?: number;

    @ApiPropertyOptional({ default: true })
    @IsOptional()
    @IsBoolean()
    is_active?: boolean;
}

/** POST /api/admin/hr/employees/:id/exit */
export class RecordExitDto {
    @ApiProperty({ enum: EXIT_TYPES })
    @IsEnum(EXIT_TYPES)
    exit_type: (typeof EXIT_TYPES)[number];

    @ApiProperty({ example: '2026-08-17' })
    @IsDateString()
    initiated_on: string;

    @ApiProperty({
        example: '2026-09-16',
        description:
            'Last day worked. Attendance and payroll stop accruing after this date.',
    })
    @IsDateString()
    last_working_date: string;

    @ApiPropertyOptional({ example: 30 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    notice_period_days?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    reason?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    exit_interview_notes?: string;

    @ApiPropertyOptional({ default: true })
    @IsOptional()
    @IsBoolean()
    rehire_eligible?: boolean;
}

/** PATCH /api/admin/hr/exits/:exitId/clearance/:itemId */
export class UpdateClearanceItemDto {
    @ApiProperty({ enum: ['pending', 'cleared', 'withheld', 'not_applicable'] })
    @IsEnum(['pending', 'cleared', 'withheld', 'not_applicable'])
    status: 'pending' | 'cleared' | 'withheld' | 'not_applicable';

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    note?: string;
}

/** POST /api/admin/hr/employees/:id/documents */
export class EmployeeDocumentDto {
    @ApiProperty({ example: 'cnic' })
    @IsString()
    @MaxLength(48)
    doc_type: string;

    @ApiProperty()
    @IsString()
    file_url: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(64)
    document_number?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsDateString()
    issued_on?: string;

    @ApiPropertyOptional({
        description: 'Drives the expiry alert sweep — set it for certificates.',
    })
    @IsOptional()
    @IsDateString()
    expires_on?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    note?: string;
}

/** POST /api/admin/hr/employees/:id/warnings */
export class EmployeeWarningDto {
    @ApiProperty({ example: 'written_warning' })
    @IsString()
    @MaxLength(48)
    warning_type: string;

    @ApiPropertyOptional({ enum: ['low', 'medium', 'high', 'final'] })
    @IsOptional()
    @IsEnum(['low', 'medium', 'high', 'final'])
    severity?: 'low' | 'medium' | 'high' | 'final';

    @ApiProperty({ example: '2026-08-17' })
    @IsDateString()
    issued_on: string;

    @ApiProperty()
    @IsString()
    reason: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    document_url?: string;
}

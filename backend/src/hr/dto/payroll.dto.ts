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

/** POST /api/admin/hr/payroll/runs */
export class CreateRunDto {
    @ApiProperty({ example: '2026-08-01' })
    @IsDateString()
    period_from: string;

    @ApiProperty({ example: '2026-08-31' })
    @IsDateString()
    period_to: string;

    @ApiPropertyOptional({ description: 'Omit to run every branch in scope.' })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    branch_id?: number;
}

/** POST /api/admin/hr/payroll/runs/:id/approve */
export class ApproveRunDto {
    @ApiPropertyOptional({
        description:
            'Approve despite preflight blockers (e.g. unapproved overtime). The accepted blockers are written to the audit log.',
        default: false,
    })
    @IsOptional()
    @IsBoolean()
    force?: boolean;
}

/** POST /api/admin/hr/payroll/runs/:id/reverse */
export class ReverseRunDto {
    @ApiProperty({ example: 'August attendance corrected after approval' })
    @IsString()
    @Length(3, 2000)
    reason: string;
}

/** POST /api/admin/hr/payroll/payslips/:lineId/adjustments */
export class CreatePayrollAdjustmentDto {
    @ApiProperty({ enum: ['waive', 'add_deduction', 'add_earning'] })
    @IsEnum(['waive', 'add_deduction', 'add_earning'])
    direction: 'waive' | 'add_deduction' | 'add_earning';

    @ApiProperty({ example: 500 })
    @Type(() => Number)
    @IsNumber()
    @Min(0.01)
    amount: number;

    @ApiProperty({
        example: 'Late deduction waived — verified bike breakdown',
        description: 'Mandatory. The database also rejects a blank reason.',
    })
    @IsString()
    @Length(3, 2000)
    reason: string;

    @ApiPropertyOptional({
        example: 'late',
        description: 'The computed line this offsets, when it offsets one.',
    })
    @IsOptional()
    @IsString()
    target_component_key?: string;
}

/** POST /api/admin/hr/advances */
export class CreateAdvanceDto {
    @ApiProperty({ example: 7 })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    employee_id: number;

    @ApiProperty({ example: 10000 })
    @Type(() => Number)
    @IsNumber()
    @Min(0.01)
    principal_amount: number;

    @ApiProperty({
        example: 2500,
        description: 'Recovered per approved payroll run.',
    })
    @Type(() => Number)
    @IsNumber()
    @Min(0.01)
    installment_amount: number;

    @ApiPropertyOptional({
        description: 'Derived from the amounts if omitted.',
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    installments_total?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsDateString()
    disbursed_on?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    note?: string;
}

/** POST /api/admin/hr/advances/:id/write-off */
export class WriteOffAdvanceDto {
    @ApiProperty({ example: 'Balance forgiven on compassionate grounds' })
    @IsString()
    @Length(3, 2000)
    reason: string;
}

/** POST / PUT /api/admin/hr/employees/:id/salary */
export class SalaryStructureDto {
    @ApiProperty({ example: '2026-09-01' })
    @IsDateString()
    effective_from: string;

    @ApiProperty({ example: 30000 })
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    basic_amount: number;

    @ApiPropertyOptional({ enum: ['monthly', 'daily', 'hourly'] })
    @IsOptional()
    @IsEnum(['monthly', 'daily', 'hourly'])
    pay_type?: 'monthly' | 'daily' | 'hourly';

    @ApiPropertyOptional({
        enum: ['fixed_30', 'days_in_month', 'working_days'],
        description:
            'How a day of pay is derived. fixed_30 is the agreed default: an absent day costs the same in February as in July.',
    })
    @IsOptional()
    @IsEnum(['fixed_30', 'days_in_month', 'working_days'])
    daily_rate_basis?: 'fixed_30' | 'days_in_month' | 'working_days';

    @ApiPropertyOptional({
        example: 60,
        description: 'Riders: paid per delivered order on top of basic.',
    })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    per_delivered_order_amount?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    change_reason?: string;

    @ApiPropertyOptional({
        description: 'Allowances and recurring deductions.',
        type: 'array',
    })
    @IsOptional()
    components?: Array<{
        component_key: string;
        name: string;
        kind: 'earning' | 'deduction';
        calc_type: 'flat' | 'percent_of_basic';
        amount: number;
    }>;
}

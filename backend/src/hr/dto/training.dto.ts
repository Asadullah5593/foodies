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

/** POST /api/admin/hr/training/programs */
export class CreateProgramDto {
    @ApiProperty({ example: 'Food Safety Level 2' })
    @IsString()
    @Length(2, 160)
    name: string;

    @ApiPropertyOptional({ description: 'Derived from the name if omitted.' })
    @IsOptional()
    @IsString()
    @Length(2, 48)
    code?: string;

    @ApiPropertyOptional({ example: 'food_safety' })
    @IsOptional()
    @IsString()
    @Length(2, 48)
    category?: string;

    @ApiPropertyOptional({ example: 2 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    level?: number;

    @ApiPropertyOptional({ example: 8 })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    duration_hours?: number;

    @ApiPropertyOptional({
        example: 24,
        description:
            'Months a completion stays valid. Omit for never — set it for anything that must be recertified.',
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    validity_months?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    is_mandatory?: boolean;
}

/** POST /api/admin/hr/training/employees/:id/assign */
export class AssignTrainingDto {
    @ApiProperty({ example: 3 })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    program_id: number;
}

/** PATCH /api/admin/hr/training/records/:id */
export class RecordTrainingDto {
    @ApiProperty({ enum: ['in_progress', 'completed', 'failed'] })
    @IsEnum(['in_progress', 'completed', 'failed'])
    status: 'in_progress' | 'completed' | 'failed';

    @ApiPropertyOptional({ description: 'Defaults to today.' })
    @IsOptional()
    @IsDateString()
    completed_on?: string;

    @ApiPropertyOptional({ example: 85 })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    score?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    certificate_url?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    note?: string;
}

/** POST /api/admin/hr/training/requirements */
export class SetRequirementDto {
    @ApiProperty({ example: 5 })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    designation_id: number;

    @ApiProperty({ example: 3 })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    program_id: number;

    @ApiPropertyOptional({ enum: ['promotion_into', 'holding_role'] })
    @IsOptional()
    @IsEnum(['promotion_into', 'holding_role'])
    required_for?: 'promotion_into' | 'holding_role';

    @ApiPropertyOptional({ example: 70 })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    min_score?: number;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    IsDateString,
    IsEnum,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    Length,
    Min,
} from 'class-validator';

export const AD_HOC_REASONS = [
    'promotion_consideration',
    'performance_concern',
    'post_training_assessment',
    'disciplinary',
    'pre_exit',
] as const;

export const REVIEW_OUTCOMES = [
    'promoted',
    'no_promotion',
    'increment_only',
    'pip',
    'terminate',
] as const;

/**
 * POST /api/admin/hr/reviews/ad-hoc
 *
 * Creates a cycle with origin=manual, which the scheduler never reads — so this
 * cannot delay, replace or satisfy the scheduled cadence.
 */
export class CreateAdHocReviewDto {
    @ApiProperty({ example: 7 })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    employee_id: number;

    @ApiProperty({ enum: AD_HOC_REASONS })
    @IsEnum(AD_HOC_REASONS)
    ad_hoc_reason: (typeof AD_HOC_REASONS)[number];

    @ApiProperty({ example: '2026-09-30' })
    @IsDateString()
    due_date: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsDateString()
    period_from?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    reviewer_user_id?: number;
}

/** PATCH /api/admin/hr/reviews/cycles/:id */
export class SaveReviewDraftDto {
    @ApiPropertyOptional({
        description:
            'Question key → answer. Merged into what is already saved.',
    })
    @IsOptional()
    answers?: Record<string, unknown>;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    strengths?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    improvements?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    reviewer_comments?: string;
}

/** POST /api/admin/hr/reviews/cycles/:id/submit */
export class SubmitReviewDto {
    @ApiProperty({ enum: REVIEW_OUTCOMES })
    @IsEnum(REVIEW_OUTCOMES)
    outcome: (typeof REVIEW_OUTCOMES)[number];

    @ApiPropertyOptional({
        description: 'Required when the outcome is `promoted`.',
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    promoted_to_designation_id?: number;

    @ApiPropertyOptional({
        description:
            'New monthly basic. Optional even on a promotion — a title change without a raise is legitimate.',
    })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    new_basic_amount?: number;

    @ApiPropertyOptional({ description: 'Defaults to today on approval.' })
    @IsOptional()
    @IsDateString()
    effective_from?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    strengths?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    improvements?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    reviewer_comments?: string;
}

/** POST /api/admin/hr/reviews/cycles/:id/skip */
export class SkipCycleDto {
    @ApiProperty({ example: 'Employee on extended leave' })
    @IsString()
    @Length(3, 2000)
    reason: string;
}

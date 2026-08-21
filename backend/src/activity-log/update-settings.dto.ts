import {
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    Max,
    Min,
    MinLength,
} from 'class-validator';

export class UpdateSettingsDto {
    @IsOptional()
    @IsIn(['off', 'mutations', 'mutations+sensitive_reads', 'all'])
    capture_level?: string;

    @IsOptional()
    @IsIn(['mask', 'full'])
    pii_mode?: string;

    /** Months kept in Postgres before a partition is archived and dropped. */
    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(12)
    hot_months?: number;

    @IsOptional()
    @IsInt()
    @Min(3)
    @Max(24)
    retention_months?: number;

    /** The caller's own password, re-entered. */
    @IsString()
    @MinLength(1)
    password: string;
}

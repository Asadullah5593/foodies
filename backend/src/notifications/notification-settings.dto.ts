import {
    IsArray,
    IsBoolean,
    IsInt,
    IsOptional,
    IsString,
} from 'class-validator';

export class UpsertNotificationSettingDto {
    @IsString()
    event_type: string;

    @IsOptional()
    @IsInt()
    branch_id?: number | null;

    @IsOptional()
    @IsInt()
    brand_id?: number | null;

    @IsArray()
    @IsInt({ each: true })
    target_role_ids: number[];

    @IsOptional()
    @IsBoolean()
    sound_enabled?: boolean;

    @IsOptional()
    @IsBoolean()
    is_enabled?: boolean;
}

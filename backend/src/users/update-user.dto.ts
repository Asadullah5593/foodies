import { IsOptional, IsString, IsNumber, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO for PUT /admin/users/:id.
 * Using a class ensures ValidationPipe (whitelist: true) does not strip role_id.
 */
export class UpdateUserDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    email?: string;

    @IsOptional()
    @IsString()
    password?: string;

    @IsOptional()
    @IsString()
    phone?: string;

    @IsOptional()
    @IsString()
    status?: string;

    /** Tenant-level role id; null = no role (branch role only). */
    @IsOptional()
    @ValidateIf((_o, v) => v !== null && v !== undefined)
    @IsNumber()
    @Type(() => Number)
    role_id?: number | null;
}

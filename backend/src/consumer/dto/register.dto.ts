import { ApiProperty } from '@nestjs/swagger';
import {
    IsEmail,
    IsNotEmpty,
    IsOptional,
    IsString,
    MinLength,
} from 'class-validator';

export class RegisterDto {
    @ApiProperty({ example: 'John Doe', description: 'Full name' })
    @IsString()
    @IsNotEmpty()
    name: string;

    @ApiProperty({
        example: 'john@example.com',
        description: 'Email address (optional)',
        required: false,
    })
    @IsOptional()
    @IsEmail()
    email?: string;

    @ApiProperty({
        example: '03001234567',
        description: 'Phone (Pakistani format)',
    })
    @IsString()
    @IsNotEmpty()
    phone: string;

    @ApiProperty({
        example: 'secret123',
        description: 'Password',
        minLength: 6,
    })
    @IsString()
    @IsNotEmpty()
    @MinLength(6, { message: 'Password must be at least 6 characters' })
    password: string;

    @ApiProperty({ example: 'secret123', description: 'Must match password' })
    @IsString()
    @IsNotEmpty()
    confirm_password: string;
}

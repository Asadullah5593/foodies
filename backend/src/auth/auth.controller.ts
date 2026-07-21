import {
    Controller,
    Post,
    Get,
    Body,
    UseGuards,
    BadRequestException,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString } from 'class-validator';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';

class LoginDto {
    /** Office staff credential. Riders must use `phone` instead. */
    @IsOptional()
    @IsEmail()
    email?: string;

    /** Rider credential: Pakistani mobile, any accepted form (03XXXXXXXXX). */
    @IsOptional()
    @IsString()
    phone?: string;

    @IsString()
    password: string;
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
    constructor(private authService: AuthService) {}

    @Post('login')
    @ApiOperation({
        summary:
            'Staff login (email + password, or phone + password for riders)',
        description:
            'Office staff sign in with `email`. Riders sign in with `phone` — a rider ' +
            'presenting an email is rejected. Supply exactly one of the two.',
    })
    @ApiBody({
        schema: {
            type: 'object',
            required: ['password'],
            properties: {
                email: { type: 'string', example: 'manager@demo.com' },
                phone: { type: 'string', example: '03001234567' },
                password: { type: 'string' },
            },
            example: { phone: '03001234567', password: 'rider123' },
        },
    })
    async login(@Body() dto: LoginDto) {
        // Ensure we have strings (body might be empty or different keys)
        const email = typeof dto?.email === 'string' ? dto.email.trim() : '';
        const phone = typeof dto?.phone === 'string' ? dto.phone.trim() : '';
        const password = typeof dto?.password === 'string' ? dto.password : '';
        if (!email && !phone) {
            throw new BadRequestException(
                'email (or phone) and password are required',
            );
        }
        return this.authService.login({ email, phone }, password);
    }

    @Post('logout')
    @UseGuards(JwtAuthGuard)
    logout() {
        return { message: 'Logged out successfully' };
    }

    @Get('user')
    @UseGuards(JwtAuthGuard)
    async user(@CurrentUser('id') userId: number) {
        const user = await this.authService.findById(userId);
        if (!user) {
            return { message: 'User not found' };
        }
        return user;
    }
}

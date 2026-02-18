import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsEmail, IsString } from 'class-validator';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';

class LoginDto {
    @IsEmail()
    email: string;

    @IsString()
    password: string;
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
    constructor(private authService: AuthService) {}

    @Post('login')
    async login(@Body() dto: LoginDto) {
        // Ensure we have strings (body might be empty or different keys)
        const email = typeof dto?.email === 'string' ? dto.email.trim() : '';
        const password = typeof dto?.password === 'string' ? dto.password : '';
        return this.authService.login(email, password);
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

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../entities/user.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { CustomersModule } from '../customers/customers.module';
import { CustomerJwtStrategy } from './customer-jwt.strategy';
import { CustomerJwtAuthGuard } from './customer-jwt-auth.guard';
import { OptionalCustomerJwtAuthGuard } from './optional-customer-jwt-auth.guard';
import { RoleAccessModule } from './role-access.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([User]),
        PassportModule,
        JwtModule.register({
            secret:
                process.env.JWT_SECRET ||
                'rough-foodie-secret-change-in-production',
            signOptions: { expiresIn: '7d' },
        }),
        CustomersModule,
        RoleAccessModule,
    ],
    controllers: [AuthController],
    providers: [
        AuthService,
        JwtStrategy,
        CustomerJwtStrategy,
        CustomerJwtAuthGuard,
        OptionalCustomerJwtAuthGuard,
    ],
    exports: [
        AuthService,
        CustomerJwtAuthGuard,
        OptionalCustomerJwtAuthGuard,
        RoleAccessModule,
    ],
})
export class AuthModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoleAccessModule } from '../auth/role-access.module';
import { Banner } from '../entities/banner.entity';
import { BannersController } from './banners.controller';
import { BannersService } from './banners.service';

@Module({
    imports: [RoleAccessModule, TypeOrmModule.forFeature([Banner])],
    controllers: [BannersController],
    providers: [BannersService],
    exports: [BannersService],
})
export class BannersModule {}

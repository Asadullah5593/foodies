import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoleAccessModule } from '../auth/role-access.module';
import { Brand } from '../entities/brand.entity';
import { BranchBrand } from '../entities/branch-brand.entity';
import { MediaModule } from '../media/media.module';
import { BrandsController } from './brands.controller';
import { BrandsService } from './brands.service';

@Module({
    imports: [
        RoleAccessModule,
        MediaModule,
        TypeOrmModule.forFeature([Brand, BranchBrand]),
    ],
    controllers: [BrandsController],
    providers: [BrandsService],
    exports: [BrandsService],
})
export class BrandsModule {}

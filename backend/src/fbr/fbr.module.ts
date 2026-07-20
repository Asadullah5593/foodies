import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Branch } from '../entities/branch.entity';
import { Order } from '../entities/order.entity';
import { FbrController } from './fbr.controller';
import { FbrService } from './fbr.service';

@Module({
    imports: [AuthModule, TypeOrmModule.forFeature([Order, Branch])],
    controllers: [FbrController],
    providers: [FbrService],
    exports: [FbrService],
})
export class FbrModule {}

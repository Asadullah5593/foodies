import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoleAccessModule } from '../auth/role-access.module';
import { BankCard } from '../entities/bank-card.entity';
import { Brand } from '../entities/brand.entity';
import { BankCardsController } from './bank-cards.controller';
import { BankCardsService } from './bank-cards.service';

@Module({
    imports: [RoleAccessModule, TypeOrmModule.forFeature([BankCard, Brand])],
    controllers: [BankCardsController],
    providers: [BankCardsService],
    exports: [BankCardsService],
})
export class BankCardsModule {}

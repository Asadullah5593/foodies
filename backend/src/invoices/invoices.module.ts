import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InvoiceTemplate } from '../entities/invoice-template.entity';
import { InvoiceTemplatesController } from './invoice-templates.controller';
import { InvoiceTemplatesService } from './invoice-templates.service';

@Module({
    imports: [TypeOrmModule.forFeature([InvoiceTemplate])],
    controllers: [InvoiceTemplatesController],
    providers: [InvoiceTemplatesService],
    exports: [InvoiceTemplatesService],
})
export class InvoicesModule {}

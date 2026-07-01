import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BankCard } from '../entities/bank-card.entity';

type BankCardDto = {
    name?: string;
    bank?: string | null;
    network?: string | null;
    bin_prefixes?: string[] | null;
    is_active?: boolean;
};

/** Tenant-scoped catalog of bank cards for card-linked discounts. */
@Injectable()
export class BankCardsService {
    constructor(
        @InjectRepository(BankCard)
        private readonly repo: Repository<BankCard>,
    ) {}

    private toResponse(c: BankCard) {
        return {
            id: c.id,
            name: c.name,
            bank: c.bank ?? null,
            network: c.network ?? null,
            bin_prefixes: c.binPrefixes ?? null,
            is_active: c.isActive,
        };
    }

    async findAll(tenantId: number | null, activeOnly = false) {
        if (tenantId == null) return [];
        const where: Record<string, unknown> = { tenantId };
        if (activeOnly) where.isActive = true;
        const list = await this.repo.find({
            where,
            order: { name: 'ASC' },
        });
        return list.map((c) => this.toResponse(c));
    }

    async create(tenantId: number, dto: BankCardDto) {
        const card = await this.repo.save(
            this.repo.create({
                tenantId,
                name: (dto.name ?? '').trim(),
                bank: dto.bank?.trim() || null,
                network: dto.network?.trim() || null,
                binPrefixes: Array.isArray(dto.bin_prefixes)
                    ? dto.bin_prefixes.map((b) => String(b).trim()).filter(Boolean)
                    : null,
                isActive: dto.is_active ?? true,
            }),
        );
        return this.toResponse(card);
    }

    async update(id: number, tenantId: number, dto: BankCardDto) {
        const card = await this.repo.findOne({ where: { id, tenantId } });
        if (!card) throw new NotFoundException('Bank card not found');
        if (dto.name !== undefined) card.name = dto.name.trim();
        if (dto.bank !== undefined) card.bank = dto.bank?.trim() || null;
        if (dto.network !== undefined)
            card.network = dto.network?.trim() || null;
        if (dto.bin_prefixes !== undefined)
            card.binPrefixes = Array.isArray(dto.bin_prefixes)
                ? dto.bin_prefixes.map((b) => String(b).trim()).filter(Boolean)
                : null;
        if (dto.is_active !== undefined) card.isActive = dto.is_active;
        await this.repo.save(card);
        return this.toResponse(card);
    }

    async remove(id: number, tenantId: number) {
        const card = await this.repo.findOne({ where: { id, tenantId } });
        if (!card) throw new NotFoundException('Bank card not found');
        await this.repo.remove(card);
        return { message: 'Bank card removed' };
    }
}

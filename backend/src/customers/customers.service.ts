import {
    Injectable,
    NotFoundException,
    ConflictException,
    BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../entities/customer.entity';
import {
    validatePakistaniPhone,
    normalizePakistaniPhone,
} from '../utils/phone';

@Injectable()
export class CustomersService {
    constructor(
        @InjectRepository(Customer) private repo: Repository<Customer>,
    ) {}

    async findAll(tenantId: number | null) {
        if (tenantId == null) return [];
        return this.repo.find({
            where: { tenantId },
            order: { id: 'ASC' },
        });
    }

    async findOne(id: number, tenantId: number | null) {
        const customer = await this.repo.findOne({
            where: tenantId != null ? { id, tenantId } : { id },
        });
        if (!customer) throw new NotFoundException('Customer not found');
        return customer;
    }

    async findByPhone(tenantId: number, phone: string) {
        const normalized = normalizePakistaniPhone(phone);
        if (!normalized) return null;
        return this.repo.findOne({ where: { tenantId, phone: normalized } });
    }

    /** Validate and normalize Pakistani phone; throw if invalid. */
    validateAndNormalizePhone(phone: string): string {
        try {
            return validatePakistaniPhone(phone);
        } catch {
            throw new BadRequestException(
                'Invalid Pakistani phone number. Use format: 03XXXXXXXXX (e.g. 03001234567)',
            );
        }
    }

    async create(tenantId: number, dto: { phone: string; name: string }) {
        const name = dto.name?.trim();
        if (!name) {
            throw new BadRequestException('Customer name is required');
        }
        const phone = this.validateAndNormalizePhone(dto.phone);
        const existing = await this.repo.findOne({
            where: { tenantId, phone },
        });
        if (existing)
            throw new ConflictException(
                'Customer with this phone already exists',
            );
        return this.repo.save(
            this.repo.create({
                tenantId,
                phone,
                name,
                loyaltyPointsBalance: 0,
            }),
        );
    }

    async update(id: number, tenantId: number, dto: { name?: string }) {
        const customer = await this.repo.findOne({ where: { id, tenantId } });
        if (!customer) throw new NotFoundException('Customer not found');
        if (dto.name !== undefined) {
            const name = dto.name?.trim();
            if (!name)
                throw new BadRequestException('Customer name is required');
            customer.name = name;
        }
        await this.repo.save(customer);
        return this.findOne(id, tenantId);
    }

    async remove(id: number, tenantId: number): Promise<void> {
        const customer = await this.repo.findOne({ where: { id, tenantId } });
        if (!customer) throw new NotFoundException('Customer not found');
        await this.repo.remove(customer);
    }
}

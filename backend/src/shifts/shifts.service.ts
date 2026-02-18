import {
    Injectable,
    NotFoundException,
    ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Shift } from '../entities/shift.entity';

@Injectable()
export class ShiftsService {
    constructor(
        @InjectRepository(Shift)
        private repo: Repository<Shift>,
    ) {}

    /** List shifts. When tenantId is set, only shifts for branches belonging to that tenant are returned. */
    async findAll(
        branchId?: number,
        status?: string,
        tenantId?: number | null,
    ) {
        const qb = this.repo
            .createQueryBuilder('s')
            .leftJoinAndSelect('s.user', 'u')
            .leftJoinAndSelect('s.branch', 'b')
            .orderBy('s.createdAt', 'DESC');
        if (tenantId != null) {
            qb.innerJoin('b.branchBrands', 'bb').innerJoin(
                'bb.brand',
                'brand',
                'brand.tenantId = :tenantId',
                { tenantId },
            );
        }
        if (branchId) qb.andWhere('s.branchId = :branchId', { branchId });
        if (status) qb.andWhere('s.status = :status', { status });
        const list = await qb.getMany();
        return list.map((s) => this.toResponse(s));
    }

    /** Get one shift by id. When tenantId is set, returns 403 if the shift's branch does not belong to that tenant. */
    async findOne(id: number, tenantId?: number | null) {
        const qb = this.repo
            .createQueryBuilder('s')
            .leftJoinAndSelect('s.user', 'u')
            .leftJoinAndSelect('s.branch', 'b')
            .where('s.id = :id', { id });
        if (tenantId != null) {
            qb.innerJoin('b.branchBrands', 'bb').innerJoin(
                'bb.brand',
                'brand',
                'brand.tenantId = :tenantId',
                { tenantId },
            );
        }
        const shift = await qb.getOne();
        if (!shift) throw new NotFoundException('Shift not found');
        return this.toResponse(shift);
    }

    async create(dto: {
        branch_id: number;
        user_id: number;
        opening_cash: number;
        notes?: string;
    }) {
        const existingOpen = await this.repo.findOne({
            where: { branchId: dto.branch_id, status: 'open' },
        });
        if (existingOpen) {
            throw new ConflictException(
                'A shift is already open for this branch. Close it before opening a new one.',
            );
        }
        const today = new Date().toISOString().slice(0, 10);
        const count = await this.repo
            .createQueryBuilder('s')
            .where('s.branchId = :branchId', { branchId: dto.branch_id })
            .andWhere('date(s.createdAt) = :today', { today })
            .getCount();
        const shiftNumber = `SH-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(count + 1).padStart(3, '0')}`;
        const shift = await this.repo.save(
            this.repo.create({
                branchId: dto.branch_id,
                userId: dto.user_id,
                shiftNumber,
                openingCash: dto.opening_cash,
                status: 'open',
                openedAt: new Date(),
                notes: dto.notes ?? null,
            }),
        );
        const loaded = await this.repo.findOne({
            where: { id: shift.id },
            relations: ['user', 'branch'],
        });
        return this.toResponse(loaded ?? shift);
    }

    /** Get the current open shift for a branch, if any. */
    async findOpenByBranch(
        branchId: number,
    ): Promise<{ id: number; shift_number: string; opened_at: string } | null> {
        const shift = await this.repo.findOne({
            where: { branchId, status: 'open' },
            order: { openedAt: 'DESC' },
        });
        if (!shift) return null;
        return {
            id: shift.id,
            shift_number: shift.shiftNumber,
            opened_at:
                shift.openedAt?.toISOString() ?? new Date().toISOString(),
        };
    }

    /** Branch IDs that currently have an open shift (for POS branch list). */
    async findBranchIdsWithOpenShift(): Promise<number[]> {
        const shifts = await this.repo.find({
            where: { status: 'open' },
            select: ['branchId'],
        });
        const ids = new Set(shifts.map((s) => s.branchId));
        return Array.from(ids);
    }

    /** Add completed order amount to the open shift's expected cash (called when an order is marked completed). */
    async addCompletedOrderAmount(
        branchId: number,
        amount: number,
    ): Promise<void> {
        const shift = await this.repo.findOne({
            where: { branchId, status: 'open' },
            order: { openedAt: 'DESC' },
        });
        if (!shift) return;
        const current =
            shift.expectedCash != null
                ? Number(shift.expectedCash)
                : Number(shift.openingCash);
        shift.expectedCash = current + amount;
        await this.repo.save(shift);
    }

    async close(
        id: number,
        dto: { actual_cash: number; notes?: string },
        tenantId?: number | null,
    ) {
        if (tenantId != null) {
            await this.findOne(id, tenantId);
        }
        const shift = await this.repo.findOne({
            where: { id },
            relations: ['user', 'branch'],
        });
        if (!shift) throw new NotFoundException('Shift not found');
        if (shift.status === 'closed')
            throw new Error('Shift is already closed');
        shift.closingCash = dto.actual_cash;
        if (shift.expectedCash == null)
            shift.expectedCash = Number(shift.openingCash);
        shift.status = 'closed';
        shift.closedAt = new Date();
        if (dto.notes !== undefined) shift.notes = dto.notes;
        await this.repo.save(shift);
        return this.toResponse(shift);
    }

    private toResponse(s: Shift) {
        return {
            id: s.id,
            branch_id: s.branchId,
            user_id: s.userId,
            shift_number: s.shiftNumber,
            opening_cash: Number(s.openingCash),
            expected_cash:
                s.expectedCash != null ? Number(s.expectedCash) : null,
            actual_cash: s.closingCash != null ? Number(s.closingCash) : null,
            difference:
                s.closingCash != null && s.expectedCash != null
                    ? Number(s.closingCash) - Number(s.expectedCash)
                    : null,
            status: s.status,
            opened_at: s.openedAt?.toISOString() ?? null,
            closed_at: s.closedAt?.toISOString() ?? null,
            notes: s.notes ?? null,
            user: (s as { user?: { id: number; name: string; email: string } })
                .user
                ? {
                      id: (s as { user: { id: number } }).user.id,
                      name: (s as { user: { name: string } }).user.name,
                      email: (s as { user: { email: string } }).user.email,
                  }
                : null,
            branch: (
                s as { branch?: { id: number; name: string; code: string } }
            ).branch
                ? {
                      id: (s as { branch: { id: number } }).branch.id,
                      name: (s as { branch: { name: string } }).branch.name,
                      code: (s as { branch: { code: string } }).branch.code,
                  }
                : null,
        };
    }
}

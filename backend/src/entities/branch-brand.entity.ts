import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Branch } from './branch.entity';
import { Brand } from './brand.entity';

@Entity('branch_brands')
export class BranchBrand {
    @PrimaryColumn()
    branchId: number;

    @PrimaryColumn()
    brandId: number;

    /**
     * Per-(branch,brand) online open/close switch. When false the brand stops
     * accepting NEW online orders (consumer app/web/kiosk) at this branch; POS is
     * unaffected (it is gated by shifts). Independent of shifts.
     */
    @Column({ default: true })
    isOpen: boolean;

    @Column({ type: 'timestamp', nullable: true })
    closedAt: Date | null;

    @Column({ type: 'int', nullable: true })
    closedByUserId: number | null;

    @ManyToOne(() => Branch, (b) => b.branchBrands, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'branch_id' })
    branch: Branch;

    @ManyToOne(() => Brand, (b) => b.branchBrands, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'brand_id' })
    brand: Brand;
}

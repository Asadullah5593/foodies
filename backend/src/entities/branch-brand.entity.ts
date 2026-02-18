import { Entity, PrimaryColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Branch } from './branch.entity';
import { Brand } from './brand.entity';

@Entity('branch_brands')
export class BranchBrand {
    @PrimaryColumn()
    branchId: number;

    @PrimaryColumn()
    brandId: number;

    @ManyToOne(() => Branch, (b) => b.branchBrands, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'branch_id' })
    branch: Branch;

    @ManyToOne(() => Brand, (b) => b.branchBrands, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'brand_id' })
    brand: Brand;
}

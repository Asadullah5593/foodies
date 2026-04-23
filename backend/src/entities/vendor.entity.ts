import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import { Branch } from './branch.entity';

@Entity('vendors')
export class Vendor {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    name: string;

    /** supplier | warehouse | branch */
    @Column({ default: 'supplier' })
    type: string;

    /** When vendor represents a branch (for inter-branch procurement). */
    @Column({ type: 'int', nullable: true })
    linkedBranchId: number | null;

    @Column({ type: 'varchar', nullable: true })
    email: string | null;

    @Column({ type: 'varchar', nullable: true })
    phone: string | null;

    @Column({ type: 'text', nullable: true })
    address: string | null;

    @Column({ default: true })
    isActive: boolean;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;

    @ManyToOne(() => Branch, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'linked_branch_id' })
    linkedBranch: Branch | null;
}


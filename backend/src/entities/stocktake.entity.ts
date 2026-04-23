import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    OneToMany,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';
import { Branch } from './branch.entity';
import { User } from './user.entity';
import { StocktakeLine } from './stocktake-line.entity';

@Entity('stocktakes')
export class Stocktake {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    branchId: number;

    @Column({ type: 'date' })
    weekStart: string;

    @Column({ type: 'date' })
    weekEnd: string;

    @Column({ type: 'date' })
    financeDay: string;

    /** open | submitted | closed */
    @Column({ default: 'open' })
    status: string;

    @Column({ type: 'int', nullable: true })
    submittedBy: number | null;

    @Column({ type: 'timestamp', nullable: true })
    submittedAt: Date | null;

    @Column({ type: 'int', nullable: true })
    closedBy: number | null;

    @Column({ type: 'timestamp', nullable: true })
    closedAt: Date | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'tenant_id' })
    tenant: Tenant;

    @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'branch_id' })
    branch: Branch;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'submitted_by' })
    submitter: User | null;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'closed_by' })
    closer: User | null;

    @OneToMany(() => StocktakeLine, (l) => l.stocktake)
    lines: StocktakeLine[];
}


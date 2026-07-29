import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    JoinColumn,
    CreateDateColumn,
    UpdateDateColumn,
    Unique,
} from 'typeorm';
import { Branch } from './branch.entity';
import { Brand } from './brand.entity';
import { User } from './user.entity';

@Entity('shifts')
@Unique(['branchId', 'shiftNumber'])
export class Shift {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    branchId: number;

    /** Brand the shift is opened for (null only on legacy pre-brand rows). */
    @Column({ type: 'int', nullable: true })
    brandId: number | null;

    @Column()
    userId: number;

    @Column()
    shiftNumber: string;

    @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
    openingCash: number;

    @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
    closingCash: number | null;

    @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
    expectedCash: number | null;

    @Column({ default: 'open' })
    status: string;

    @Column()
    openedAt: Date;

    @Column({ type: 'timestamp', nullable: true })
    closedAt: Date | null;

    /** User who closed the shift (set from the authenticated user on close). */
    @Column({ type: 'int', nullable: true })
    closedByUserId: number | null;

    @Column({ type: 'text', nullable: true })
    notes: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Branch, (b) => b.shifts, { onDelete: 'CASCADE' })
    branch: Branch;

    @ManyToOne(() => Brand, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'brand_id' })
    brand: Brand | null;

    @ManyToOne(() => User, (u) => u.shifts, { onDelete: 'CASCADE' })
    user: User;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'closed_by_user_id' })
    closer: User | null;
}

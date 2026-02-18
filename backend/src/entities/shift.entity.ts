import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    CreateDateColumn,
    UpdateDateColumn,
    Unique,
} from 'typeorm';
import { Branch } from './branch.entity';
import { User } from './user.entity';

@Entity('shifts')
@Unique(['branchId', 'shiftNumber'])
export class Shift {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    branchId: number;

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

    @Column({ type: 'text', nullable: true })
    notes: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Branch, (b) => b.shifts, { onDelete: 'CASCADE' })
    branch: Branch;

    @ManyToOne(() => User, (u) => u.shifts, { onDelete: 'CASCADE' })
    user: User;
}

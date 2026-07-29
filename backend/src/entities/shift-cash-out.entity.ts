import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    ManyToOne,
    JoinColumn,
    Index,
} from 'typeorm';
import { Shift } from './shift.entity';
import { User } from './user.entity';

/**
 * Cash removed from the till part-way through a shift — the owner collecting
 * takings from the cashier ("cash drop"). Each hand-over is its own append-only
 * row so the shift keeps a record of who took what, when and why.
 *
 * A mistaken entry is VOIDED (voided_at set), never deleted, so the paper trail
 * survives; every SUM over these rows must filter `voided_at IS NULL`.
 *
 * The total reduces the shift's expected cash: money handed over is no longer
 * expected in the drawer at close.
 */
@Entity('shift_cash_outs')
@Index('IDX_shift_cash_outs_shift', ['shiftId'])
export class ShiftCashOut {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    shiftId: number;

    /** Amount handed over. Always positive; a correction is a void, not a negative. */
    @Column({ type: 'decimal', precision: 12, scale: 2 })
    amount: number;

    /** Free text: who it went to / why (e.g. "handed to owner, lunch pickup"). */
    @Column({ type: 'varchar', nullable: true })
    note: string | null;

    /** User who recorded the cash-out (holds shifts:cash-out). */
    @Column({ type: 'int', nullable: true })
    createdBy: number | null;

    @CreateDateColumn()
    createdAt: Date;

    /** Set when the entry is voided; a voided row stops counting immediately. */
    @Column({ type: 'timestamp', nullable: true })
    voidedAt: Date | null;

    @Column({ type: 'int', nullable: true })
    voidedBy: number | null;

    @Column({ type: 'varchar', nullable: true })
    voidReason: string | null;

    @ManyToOne(() => Shift, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'shift_id' })
    shift: Shift;

    // The actor must outlive the user record — an audit row is never cascaded away.
    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'created_by' })
    creator: User | null;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'voided_by' })
    voider: User | null;
}

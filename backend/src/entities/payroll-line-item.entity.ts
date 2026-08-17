import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
} from 'typeorm';
import { PayrollLine } from './payroll-line.entity';

/**
 * One line on the payslip, with its arithmetic attached.
 *
 * `calcMeta` is the point of this table. The only useful answer to "why is my
 * salary short" is the sum shown back to the person asking — e.g.
 * `{"late_count": 3, "days_deducted": 1, "ladder": "1st free, 2nd ½ day…"}`.
 * Same pattern as the existing rider_payroll_line_items.formula_meta.
 *
 * `waiver` and `adjustment` are separate kinds from `deduction` on purpose: a
 * forgiven deduction prints as two lines, so the machine's decision and the
 * human's override are both visible rather than netted into one figure.
 */
@Entity('payroll_line_items')
export class PayrollLineItem {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    payrollLineId: number;

    @Column({ type: 'varchar', length: 80 })
    componentKey: string;

    @Column({ type: 'varchar', length: 160 })
    componentName: string;

    /** earning | deduction | waiver | adjustment */
    @Column({ type: 'varchar', length: 16 })
    kind: string;

    @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
    quantity: number;

    @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
    rate: number;

    @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
    amount: number;

    @Column({ type: 'jsonb', default: () => "'{}'" })
    calcMeta: Record<string, unknown>;

    @Column({ type: 'int', default: 0 })
    sortOrder: number;

    @CreateDateColumn()
    createdAt: Date;

    @ManyToOne(() => PayrollLine, (l) => l.items, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'payroll_line_id' })
    payrollLine: PayrollLine;
}

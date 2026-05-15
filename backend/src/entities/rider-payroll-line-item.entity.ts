import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
} from 'typeorm';
import { RiderPayrollLine } from './rider-payroll-line.entity';

@Entity('rider_payroll_line_items')
export class RiderPayrollLineItem {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    payrollLineId: number;

    @Column({ type: 'varchar', length: 80 })
    componentKey: string;

    @Column({ type: 'varchar', length: 120 })
    componentName: string;

    @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
    amount: number;

    @Column({ type: 'jsonb', default: () => "'{}'" })
    formulaMeta: Record<string, unknown>;

    @CreateDateColumn()
    createdAt: Date;

    @ManyToOne(() => RiderPayrollLine, (line) => line.items, {
        onDelete: 'CASCADE',
    })
    @JoinColumn({ name: 'payroll_line_id' })
    payrollLine: RiderPayrollLine;
}

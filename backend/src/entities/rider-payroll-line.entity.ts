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
import { RiderPayrollRun } from './rider-payroll-run.entity';
import { User } from './user.entity';
import { RiderCompPlan } from './rider-comp-plan.entity';
import { RiderPayrollLineItem } from './rider-payroll-line-item.entity';

@Entity('rider_payroll_lines')
export class RiderPayrollLine {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    runId: number;

    @Column()
    riderUserId: number;

    @Column({ nullable: true })
    planId: number | null;

    @Column({ type: 'varchar', length: 8, default: 'PKR' })
    currency: string;

    @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
    totalAmount: number;

    @Column({ type: 'int', default: 0 })
    attendanceMinutes: number;

    @Column({ type: 'int', default: 0 })
    completedRides: number;

    @Column({ type: 'int', default: 0 })
    timelyDeliveries: number;

    @Column({ type: 'decimal', precision: 4, scale: 2, nullable: true })
    avgRating: number | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => RiderPayrollRun, (run) => run.lines, {
        onDelete: 'CASCADE',
    })
    @JoinColumn({ name: 'run_id' })
    run: RiderPayrollRun;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'rider_user_id' })
    riderUser: User;

    @ManyToOne(() => RiderCompPlan, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'plan_id' })
    plan: RiderCompPlan | null;

    @OneToMany(() => RiderPayrollLineItem, (item) => item.payrollLine, {
        cascade: true,
    })
    items: RiderPayrollLineItem[];
}

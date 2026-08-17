import {
    Column,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
} from 'typeorm';
import { EmployeeSalaryStructure } from './employee-salary-structure.entity';

/**
 * An allowance or recurring deduction on a salary structure — fuel, mobile,
 * meal, accommodation, union dues.
 *
 * These are the "perks / benefits" the client asked to track, itemised so a
 * payslip can show them individually rather than folding everything into one
 * opaque basic figure.
 */
@Entity('employee_salary_components')
export class EmployeeSalaryComponent {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    structureId: number;

    @Column({ type: 'varchar', length: 80 })
    componentKey: string;

    @Column({ type: 'varchar', length: 120 })
    name: string;

    /** earning | deduction */
    @Column({ type: 'varchar', length: 16, default: 'earning' })
    kind: string;

    /** flat | percent_of_basic */
    @Column({ type: 'varchar', length: 24, default: 'flat' })
    calcType: string;

    @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
    amount: number;

    @Column({ default: true })
    isTaxable: boolean;

    @Column({ type: 'int', default: 0 })
    sortOrder: number;

    @ManyToOne(() => EmployeeSalaryStructure, (s) => s.components, {
        onDelete: 'CASCADE',
    })
    @JoinColumn({ name: 'structure_id' })
    structure: EmployeeSalaryStructure;
}

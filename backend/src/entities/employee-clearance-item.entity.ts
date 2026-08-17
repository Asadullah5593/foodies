import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';
import { EmployeeExit } from './employee-exit.entity';
import { User } from './user.entity';

/**
 * One line of an exit clearance checklist — uniform returned, keys handed back,
 * POS access revoked, cash handed over, outstanding advance settled.
 *
 * A default set is created with the exit so nothing depends on a manager
 * remembering the list. `outstanding_advance` is the item that later reconciles
 * against payroll: it is the reason a final settlement cannot simply be "last
 * month's salary".
 */
@Entity('employee_clearance_items')
export class EmployeeClearanceItem {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    exitId: number;

    /**
     * uniform | keys | pos_access | cash_handover | equipment |
     * outstanding_advance | other
     */
    @Column({ type: 'varchar', length: 32 })
    itemType: string;

    @Column({ type: 'varchar', length: 200 })
    description: string;

    @Column({ type: 'varchar', length: 64, nullable: true })
    responsibleRole: string | null;

    /** pending | cleared | withheld | not_applicable */
    @Column({ type: 'varchar', length: 32, default: 'pending' })
    status: string;

    @Column({ type: 'int', nullable: true })
    clearedBy: number | null;

    @Column({ type: 'timestamp', nullable: true })
    clearedAt: Date | null;

    @Column({ type: 'text', nullable: true })
    note: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => EmployeeExit, (e) => e.clearanceItems, {
        onDelete: 'CASCADE',
    })
    @JoinColumn({ name: 'exit_id' })
    exit: EmployeeExit;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'cleared_by' })
    clearer: User | null;
}

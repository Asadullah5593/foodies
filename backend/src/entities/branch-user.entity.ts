import {
    Entity,
    PrimaryColumn,
    Column,
    ManyToOne,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Branch } from './branch.entity';
import { User } from './user.entity';
import { Role } from './role.entity';
import { Brand } from './brand.entity';

@Entity('branch_users')
export class BranchUser {
    @PrimaryColumn()
    branchId: number;

    @PrimaryColumn()
    userId: number;

    @Column()
    roleId: number;

    /**
     * First of `brandIds`, kept in step with it. Retained because it carries the
     * foreign key (an int[] cannot) and because a reader still on this column
     * then sees a narrower lock rather than none. Read the lock through
     * `rowBrandIds()` in brand-lock.ts, never straight off either column.
     */
    @Column({ type: 'int', nullable: true })
    brandId: number | null;

    /**
     * Every brand the user is locked to at this branch; null/empty = all brands.
     * The row is keyed on (branchId, userId), so the set lives here rather than
     * in extra rows.
     */
    @Column({ type: 'int', array: true, nullable: true })
    brandIds: number[] | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Branch, (b) => b.branchUsers, { onDelete: 'CASCADE' })
    branch: Branch;

    @ManyToOne(() => User, (u) => u.branchUsers, { onDelete: 'CASCADE' })
    user: User;

    @ManyToOne(() => Role, { onDelete: 'RESTRICT' })
    role: Role;

    @ManyToOne(() => Brand, { onDelete: 'SET NULL', nullable: true })
    brand: Brand | null;
}

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

    /** When set, the user is locked to this brand at the branch (null = all brands). */
    @Column({ type: 'int', nullable: true })
    brandId: number | null;

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

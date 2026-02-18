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

@Entity('branch_users')
export class BranchUser {
    @PrimaryColumn()
    branchId: number;

    @PrimaryColumn()
    userId: number;

    @Column()
    roleId: number;

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
}

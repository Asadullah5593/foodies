import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    OneToMany,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Customer } from './customer.entity';
import { Branch } from './branch.entity';
import { CartItem } from './cart-item.entity';

@Entity('carts')
export class Cart {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    customerId: number;

    @Column()
    branchId: number;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Customer, { onDelete: 'CASCADE' })
    customer: Customer;

    @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
    branch: Branch;

    @OneToMany(() => CartItem, (item) => item.cart, { cascade: true })
    items: CartItem[];
}

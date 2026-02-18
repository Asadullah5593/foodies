import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Branch } from './branch.entity';

@Entity('kitchen_stations')
export class KitchenStation {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    branchId: number;

    @Column()
    name: string;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Branch, (b) => b.kitchenStations, { onDelete: 'CASCADE' })
    branch: Branch;
}

import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';
import { ModifierGroup } from './modifier-group.entity';

@Entity('modifiers')
export class Modifier {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    modifierGroupId: number;

    @Column()
    name: string;

    @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
    price: number;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => ModifierGroup, (mg) => mg.modifiers, {
        onDelete: 'CASCADE',
    })
    modifierGroup: ModifierGroup;
}

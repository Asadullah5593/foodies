import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Branch } from './branch.entity';
import { MenuCategory } from './menu-category.entity';
import { KitchenStation } from './kitchen-station.entity';

@Entity('printer_routes')
export class PrinterRoute {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    branchId: number;

    @Column({ nullable: true })
    categoryId: number | null;

    @Column({ nullable: true })
    stationId: number | null;

    @Column()
    printerName: string;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Branch, { onDelete: 'CASCADE' })
    branch: Branch;

    @ManyToOne(() => MenuCategory, { onDelete: 'SET NULL' })
    category: MenuCategory;

    @ManyToOne(() => KitchenStation, { onDelete: 'SET NULL' })
    station: KitchenStation;
}

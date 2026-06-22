import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';

@Entity('banners')
export class Banner {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    tenantId: number;

    @Column()
    title: string;

    @Column({ type: 'varchar', nullable: true })
    subtitle: string | null;

    @Column({ type: 'varchar' })
    imageUrl: string;

    @Column({ type: 'varchar', nullable: true })
    linkUrl: string | null;

    @Column({ default: true })
    isActive: boolean;

    @Column({ default: 0 })
    sortOrder: number;

    @Column({ type: 'timestamp', nullable: true })
    validFrom: Date | null;

    @Column({ type: 'timestamp', nullable: true })
    validUntil: Date | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @ManyToOne(() => Tenant, (t) => t.banners, { onDelete: 'CASCADE' })
    tenant: Tenant;
}

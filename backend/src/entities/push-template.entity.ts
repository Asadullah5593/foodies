import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';

/** A saved message (title, text, image) to start a new notification from. */
@Entity('push_templates')
export class PushTemplate {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: 'tenant_id' })
    tenantId: number;

    @Column({ name: 'brand_id', type: 'int', nullable: true })
    brandId: number | null;

    @Column()
    name: string;

    @Column({ length: 120 })
    title: string;

    @Column({ type: 'text' })
    body: string;

    @Column({ name: 'image_url', type: 'text', nullable: true })
    imageUrl: string | null;

    @Column({ name: 'created_by', type: 'int', nullable: true })
    createdBy: number | null;

    @Column({ name: 'updated_by', type: 'int', nullable: true })
    updatedBy: number | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
    updatedAt: Date;
}

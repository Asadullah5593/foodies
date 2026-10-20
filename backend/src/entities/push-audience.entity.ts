import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';
import type { AudienceSpec } from '../push-messages/push-message.types';

/**
 * A saved, named audience ("Lapsed Wok & Go regulars"). A message that points
 * at one reads its current rules at every send, so editing the audience
 * updates every repeating message that uses it.
 */
@Entity('push_audiences')
export class PushAudience {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ name: 'tenant_id' })
    tenantId: number;

    /** Set when a brand-locked user saved it; only that brand's staff see it. */
    @Column({ name: 'brand_id', type: 'int', nullable: true })
    brandId: number | null;

    @Column()
    name: string;

    @Column({ type: 'text', nullable: true })
    description: string | null;

    @Column({ type: 'jsonb' })
    rules: AudienceSpec;

    @Column({ name: 'created_by', type: 'int', nullable: true })
    createdBy: number | null;

    @Column({ name: 'updated_by', type: 'int', nullable: true })
    updatedBy: number | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
    updatedAt: Date;
}

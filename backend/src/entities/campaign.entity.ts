import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Tenant } from './tenant.entity';

/**
 * Campaign = the top-level advertising umbrella. Groups one or more
 * campaign_items (banners) under a shared theme/validity/report. A campaign
 * NEVER changes prices — pricing always lives in the offers (discounts) engine.
 */
@Entity('campaigns')
@Index('IDX_campaigns_tenant_active', ['tenantId', 'isActive'])
export class Campaign {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tenantId: number;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'image_url', type: 'varchar', nullable: true })
  imageUrl: string | null;

  @Column({ default: true })
  isActive: boolean;

  @Column({ default: 0 })
  sortOrder: number;

  @Column({ type: 'timestamp', nullable: true })
  validFrom: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  validUntil: Date | null;

  /** Brand-locked admin scoping; null = all brands. */
  @Column('simple-json', { nullable: true })
  eligibilityBrandIds: number[] | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;
}

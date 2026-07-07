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
import { Campaign } from './campaign.entity';
import { Discount } from './discount.entity';

export type CampaignItemKind = 'offer' | 'deal' | 'info';
export type CampaignDestinationType =
  | 'product'
  | 'deal'
  | 'category'
  | 'brand'
  | 'branch'
  | 'none';

/**
 * A single banner/carousel card shown in the mobile app. Carries the creative
 * (image/title/subtitle), a destination the app resolves to a screen, and an
 * optional link to one offer (kind='offer') or a deal (kind='deal'); kind='info'
 * is purely informational.
 */
@Entity('campaign_items')
@Index('IDX_campaign_items_campaign', ['campaignId'])
export class CampaignItem {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  campaignId: number;

  @Column({ type: 'varchar' })
  kind: CampaignItemKind;

  @Column({ type: 'varchar', nullable: true })
  title: string | null;

  @Column({ type: 'varchar', nullable: true })
  subtitle: string | null;

  @Column({ name: 'image_url', type: 'varchar', nullable: true })
  imageUrl: string | null;

  @Column({ default: 0 })
  sortOrder: number;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'timestamp', nullable: true })
  validFrom: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  validUntil: Date | null;

  /** kind='offer' → the linked discount (offer). */
  @Column({ name: 'offer_id', type: 'int', nullable: true })
  offerId: number | null;

  /** kind='deal' → the deal menu_item advertised (price untouched). */
  @Column({ name: 'deal_menu_item_id', type: 'int', nullable: true })
  dealMenuItemId: number | null;

  @Column({ name: 'destination_type', type: 'varchar', nullable: true })
  destinationType: CampaignDestinationType | null;

  @Column({ name: 'destination_id', type: 'int', nullable: true })
  destinationId: number | null;

  /** Auto-generated shareable deep link wrapping the destination params. */
  @Column({ name: 'deep_link_url', type: 'varchar', nullable: true })
  deepLinkUrl: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => Campaign, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign;

  @ManyToOne(() => Discount, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'offer_id' })
  offer: Discount | null;
}

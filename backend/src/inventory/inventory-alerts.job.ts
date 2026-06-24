import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { InventoryService } from './inventory.service';
import {
    NotificationsService,
    SystemAlertItem,
} from '../notifications/notifications.service';

/**
 * Periodic sweeps that turn inventory conditions into system-managed
 * notifications. Low stock is swept frequently; near-expiry daily. Each sweep
 * reconciles the open notifications against the current condition set — opening
 * new alerts and auto-resolving ones whose condition cleared (stock recovered,
 * batch consumed) — so alerts never duplicate and never linger.
 */
@Injectable()
export class InventoryAlertsJob {
    private readonly logger = new Logger(InventoryAlertsJob.name);

    constructor(
        private readonly inventoryService: InventoryService,
        private readonly notificationsService: NotificationsService,
        private readonly dataSource: DataSource,
    ) {}

    @Cron(CronExpression.EVERY_30_MINUTES)
    async sweepLowStockCron() {
        await this.sweepLowStock();
    }

    @Cron(CronExpression.EVERY_DAY_AT_3AM)
    async sweepNearExpiryCron() {
        await this.sweepNearExpiry();
    }

    /** Run both sweeps immediately (admin "run now" / testing). */
    async runNow() {
        const low = await this.sweepLowStock();
        const expiry = await this.sweepNearExpiry();
        return { lowStock: low, nearExpiry: expiry };
    }

    private async branchScopes(): Promise<
        Array<{ tenantId: number; branchId: number }>
    > {
        const rows = (await this.dataSource.query(
            `SELECT DISTINCT tenant_id, branch_id FROM inventory_on_hand
             UNION
             SELECT DISTINCT tenant_id, branch_id FROM inventory_batches`,
        )) as unknown as Array<{
            tenant_id: number | null;
            branch_id: number | null;
        }>;
        return rows
            .filter((r) => r.tenant_id != null && r.branch_id != null)
            .map((r) => ({
                tenantId: Number(r.tenant_id),
                branchId: Number(r.branch_id),
            }));
    }

    async sweepLowStock(): Promise<{ opened: number; resolved: number }> {
        let opened = 0;
        let resolved = 0;
        for (const { tenantId, branchId } of await this.branchScopes()) {
            try {
                const alerts = await this.inventoryService.getLowStockAlerts(
                    tenantId,
                    branchId,
                );
                const items: SystemAlertItem[] = alerts.map((a) => ({
                    dedupeKey: `inv.low_stock:${branchId}:${a.inventory_item_id}`,
                    title: `Low stock: ${a.item_name}`,
                    body: `On hand ${a.on_hand_qty} ≤ reorder point ${a.reorder_point}`,
                    data: {
                        inventoryItemId: a.inventory_item_id,
                        itemCode: a.item_code,
                        itemName: a.item_name,
                        onHandQty: a.on_hand_qty,
                        reorderPoint: a.reorder_point,
                        branchId,
                    },
                }));
                const res = await this.notificationsService.syncSystemAlerts(
                    tenantId,
                    branchId,
                    'inventory.low_stock',
                    items,
                );
                opened += res.opened;
                resolved += res.resolved;
            } catch (e) {
                this.logger.error(
                    `Low-stock sweep failed for tenant ${tenantId} branch ${branchId}: ${String(e)}`,
                );
            }
        }
        this.logger.log(
            `Low-stock sweep complete opened=${opened} resolved=${resolved}`,
        );
        return { opened, resolved };
    }

    async sweepNearExpiry(): Promise<{ opened: number; resolved: number }> {
        let opened = 0;
        let resolved = 0;
        for (const { tenantId, branchId } of await this.branchScopes()) {
            try {
                const alerts = await this.inventoryService.getNearExpiryAlerts(
                    tenantId,
                    branchId,
                );
                const items: SystemAlertItem[] = alerts.map((a) => ({
                    dedupeKey: `inv.near_expiry:${a.batch_id}`,
                    title: `Near expiry: ${a.item_name}`,
                    body: `Batch expires in ${a.days_to_expiry}d (${a.expiry_date}) · qty ${a.on_hand_qty}`,
                    data: {
                        batchId: a.batch_id,
                        inventoryItemId: a.inventory_item_id,
                        itemCode: a.item_code,
                        itemName: a.item_name,
                        expiryDate: a.expiry_date,
                        daysToExpiry: a.days_to_expiry,
                        onHandQty: a.on_hand_qty,
                        branchId,
                    },
                }));
                const res = await this.notificationsService.syncSystemAlerts(
                    tenantId,
                    branchId,
                    'inventory.near_expiry',
                    items,
                );
                opened += res.opened;
                resolved += res.resolved;
            } catch (e) {
                this.logger.error(
                    `Near-expiry sweep failed for tenant ${tenantId} branch ${branchId}: ${String(e)}`,
                );
            }
        }
        this.logger.log(
            `Near-expiry sweep complete opened=${opened} resolved=${resolved}`,
        );
        return { opened, resolved };
    }
}

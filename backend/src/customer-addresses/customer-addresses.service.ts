import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { normalizeAddressKey } from './address-key';

export interface SavedAddress {
    id: number;
    label: string | null;
    address: string;
    latitude: number | null;
    longitude: number | null;
    notes: string | null;
    times_used: number;
    last_used_at: string | null;
}

export interface RememberInput {
    tenantId: number;
    brandId: number | null;
    customerId: number | null;
    customerPhone: string | null;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    placedAt?: Date | null;
}

/**
 * The address book behind "where shall we send it — the same place as last
 * time?". Written from every order that goes out, read at the till.
 */
@Injectable()
export class CustomerAddressesService {
    private readonly logger = new Logger(CustomerAddressesService.name);

    constructor(private readonly dataSource: DataSource) {}

    /**
     * Record where an order actually went.
     *
     * Called AFTER the order is committed and never inside its transaction:
     * remembering an address is a convenience, and no failure here may cost a
     * customer their order. Anything that goes wrong is logged and swallowed.
     *
     * Only delivery orders that resolved to a point are kept — the POS refuses
     * to place one without coordinates, so an address lacking them could never
     * be picked anyway.
     */
    async rememberFromOrder(input: RememberInput): Promise<void> {
        try {
            const phone = (input.customerPhone ?? '').trim();
            const address = (input.address ?? '').trim();
            const key = normalizeAddressKey(address);
            if (
                !phone ||
                !address ||
                !key ||
                input.latitude == null ||
                input.longitude == null
            ) {
                return;
            }

            await this.dataSource.query(
                `INSERT INTO customer_addresses
                    (tenant_id, customer_phone, customer_id, address, address_key,
                     latitude, longitude, brand_ids, times_used, last_used_at,
                     created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7,
                         CASE WHEN $8::int IS NULL THEN NULL ELSE ARRAY[$8::int] END,
                         1, COALESCE($9::timestamp, now()), now(), now())
                 ON CONFLICT (tenant_id, customer_phone, address_key)
                 WHERE deleted_at IS NULL
                 DO UPDATE SET
                     times_used = customer_addresses.times_used + 1,
                     -- A backdated import must not drag "last used" backwards.
                     last_used_at = GREATEST(
                         COALESCE(customer_addresses.last_used_at, to_timestamp(0)),
                         EXCLUDED.last_used_at
                     ),
                     -- Keep the newest spelling and the newest fix on the map.
                     address = EXCLUDED.address,
                     latitude = COALESCE(EXCLUDED.latitude, customer_addresses.latitude),
                     longitude = COALESCE(EXCLUDED.longitude, customer_addresses.longitude),
                     customer_id = COALESCE(EXCLUDED.customer_id, customer_addresses.customer_id),
                     brand_ids = ARRAY(
                         SELECT DISTINCT unnest(
                             COALESCE(customer_addresses.brand_ids, '{}'::int[])
                             || COALESCE(EXCLUDED.brand_ids, '{}'::int[])
                         ) ORDER BY 1
                     ),
                     updated_at = now()`,
                [
                    input.tenantId,
                    phone,
                    input.customerId,
                    address,
                    key,
                    input.latitude,
                    input.longitude,
                    input.brandId,
                    input.placedAt ?? null,
                ],
            );
        } catch (e) {
            this.logger.warn(
                `Could not record delivery address for order: ${
                    e instanceof Error ? e.message : String(e)
                }`,
            );
        }
    }

    /**
     * Addresses this number has had deliveries to, most recently used first.
     *
     * `allowedBrandIds` non-null means the caller is brand-locked and sees only
     * what their own brand has served. Branch is deliberately not a filter: an
     * address is an address, and a customer who ordered from one branch may
     * order from another.
     *
     * Only addresses carrying coordinates are returned, because picking one
     * without them would fail the POS's own check that a delivery order has a
     * point for the rider and the distance-priced fee.
     */
    async listForPhone(
        tenantId: number,
        phone: string,
        allowedBrandIds?: number[] | null,
        limit = 8,
    ): Promise<SavedAddress[]> {
        const params: unknown[] = [tenantId, phone.trim()];
        let brandClause = '';
        if (allowedBrandIds != null) {
            if (allowedBrandIds.length === 0) return [];
            params.push(allowedBrandIds);
            brandClause = ` AND ca.brand_ids && $${params.length}::int[]`;
        }
        params.push(limit);

        const rows: Array<Record<string, unknown>> =
            await this.dataSource.query(
                `SELECT ca.id, ca.label, ca.address, ca.latitude, ca.longitude,
                    ca.notes, ca.times_used, ca.last_used_at
             FROM customer_addresses ca
             WHERE ca.tenant_id = $1
               AND ca.customer_phone = $2
               AND ca.deleted_at IS NULL
               AND ca.latitude IS NOT NULL
               AND ca.longitude IS NOT NULL${brandClause}
             ORDER BY ca.last_used_at DESC NULLS LAST, ca.times_used DESC, ca.id DESC
             LIMIT $${params.length}`,
                params,
            );

        return rows.map((r) => ({
            id: Number(r.id),
            label: (r.label as string) ?? null,
            address: String(r.address),
            latitude: r.latitude != null ? Number(r.latitude) : null,
            longitude: r.longitude != null ? Number(r.longitude) : null,
            notes: (r.notes as string) ?? null,
            times_used: Number(r.times_used ?? 0),
            last_used_at:
                r.last_used_at instanceof Date
                    ? r.last_used_at.toISOString()
                    : ((r.last_used_at as string) ?? null),
        }));
    }
}

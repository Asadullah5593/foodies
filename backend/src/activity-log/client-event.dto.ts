import {
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    MaxLength,
    ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * The only client-reportable actions. A closed enum, not free text: the beacon
 * is an endpoint any logged-in browser can call, so without this an attacker —
 * or a bug — could write arbitrary action names into the audit trail and make
 * it unreadable or misleading.
 */
export const CLIENT_EVENT_ACTIONS = [
    'client.print',
    'client.export',
    'client.page-view',
] as const;

export type ClientEventAction = (typeof CLIENT_EVENT_ACTIONS)[number];

/** What was printed/exported/viewed. Also closed, for the same reason. */
export const CLIENT_EVENT_SUBJECTS = [
    'invoice',
    'kot',
    'z-report',
    'shift-report',
    'order',
    'inventory-ledger',
    'inventory-items',
    'product-sales',
    'activity-log',
    'customers',
    'rider-profiles',
    'payroll',
    'reports',
    'roles',
    'shifts',
] as const;

export class ClientEventDto {
    @IsIn(CLIENT_EVENT_ACTIONS as unknown as string[])
    action: ClientEventAction;

    @IsIn(CLIENT_EVENT_SUBJECTS as unknown as string[])
    subject: string;

    /**
     * Did a human do this, or did the app?
     *
     * Load-bearing: CustomerInvoiceModal auto-prints an invoice AND a KOT on
     * open, with no user interaction. Without this flag the log would claim a
     * person deliberately printed ~4,000 documents a day, which would make the
     * print trail worthless precisely when someone asks "who printed this?".
     */
    @IsOptional()
    @IsIn(['user', 'auto'])
    trigger?: 'user' | 'auto';

    /** The record this concerns, when there is one. */
    @IsOptional()
    @IsInt()
    entity_id?: number;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    label?: string;

    @IsOptional()
    @IsInt()
    branch_id?: number;

    @IsOptional()
    @IsInt()
    brand_id?: number;
}

/** Beacons batch, so the endpoint takes a bounded list. */
export class ClientEventBatchDto {
    @ValidateNested({ each: true })
    @Type(() => ClientEventDto)
    events: ClientEventDto[];
}

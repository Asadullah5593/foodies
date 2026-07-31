/**
 * Meezan Bank E-commerce Payment Gateway (EPG) — shared types.
 *
 * We integrate the one-phase hosted-checkout REST flow (`register.do` ->
 * `formUrl`, confirmed by polling `getOrderStatusExtended.do`). This file
 * defines the provider contract, the typed error, and the value shapes so the
 * rest of the backend never has to know the raw `.do` wire format.
 *
 * Scope decisions baked in here (locked with the bank, 2026-07):
 *  - ONE-PHASE only. Success == orderStatus 2 (Deposited).
 *  - amount is sent to the bank in the MINOR unit (paisa); the ONLY place that
 *    conversion happens is inside the provider. Callers always pass MAJOR units
 *    (PKR rupees).
 *  - currency is ISO 4217 numeric; PKR = 586.
 */

/** DI token for the active payment gateway provider (meezan | console). */
export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

export type EpgErrorCode =
    | 'EPG_CONFIG_ERROR' // missing/invalid local config (creds, amount, refs)
    | 'EPG_CONNECTION_ERROR' // could not reach the gateway (network/abort/timeout)
    | 'EPG_HTTP_ERROR' // gateway responded with an HTTP >= 400
    | 'EPG_INVALID_RESPONSE' // non-JSON / empty / unparseable gateway response
    | 'EPG_GATEWAY_ERROR'; // gateway returned a business errorCode != 0

/** Single typed error for every EPG failure mode (mirrors FbrError's shape). */
export class EpgError extends Error {
    constructor(
        public readonly code: EpgErrorCode,
        message: string,
        /** The bank's numeric `errorCode`, present only for EPG_GATEWAY_ERROR. */
        public readonly gatewayErrorCode?: string,
    ) {
        super(message);
        this.name = 'EpgError';
    }
}

/**
 * One-phase order statuses returned by getOrderStatus(Extended).
 * Note there is no `5`. Under one-phase, `2` (Deposited) is the only success.
 */
export enum EpgOrderStatus {
    RegisteredUnpaid = 0,
    Approved = 1, // one-phase: transient; two-phase: hold (we don't use two-phase)
    Deposited = 2, // SUCCESS (funds captured)
    Reversed = 3,
    Refunded = 4,
    Declined = 6,
}

export interface RegisterOrderParams {
    /**
     * Merchant order reference sent to the bank. MUST be globally unique per
     * merchant forever (a used one is burned). We send `orders.order_id`
     * (FDS-XXXXXXXX) plus an attempt suffix — never the daily `order_number`.
     */
    orderNumber: string;
    /** Order amount in MAJOR units (PKR rupees). Provider converts to paisa. */
    amountMajor: number;
    /** REQUIRED by EPG — where the customer is redirected after payment. */
    returnUrl: string;
    /**
     * Where the customer is redirected on failure. The bank told us REST
     * `register.do` does not accept this; sent only when provided so we can
     * verify that claim empirically in UAT. Distinguish success/fail via the
     * status poll regardless.
     */
    failUrl?: string;
    /** Free-form description shown to the payer / stored on the order. */
    description?: string;
    /** ISO 639-1 language for the payment page + error messages. */
    language?: string;
}

export interface RegisterOrderResult {
    /** The bank's order id (a.k.a. mdOrder) — used for later status/refund. */
    bankOrderId: string;
    /** Hosted payment page URL the app opens in a WebView / Custom Tab. */
    formUrl: string;
}

/** Reference for a status lookup. `bankOrderId` wins if both are supplied. */
export interface OrderStatusRef {
    bankOrderId?: string;
    orderNumber?: string;
}

export interface OrderStatusResult {
    orderStatus: EpgOrderStatus | number;
    orderNumber?: string;
    /** Amount as returned by the gateway, in MINOR units (paisa). */
    amountMinor?: number;
    currency?: string;
    actionCode?: number;
    actionCodeDescription?: string;
    /** paymentAmountInfo block (getOrderStatusExtended version 03 only). */
    approvedAmountMinor?: number;
    depositedAmountMinor?: number;
    refundedAmountMinor?: number;
    /** Full raw gateway response, kept verbatim for audit/reconciliation. */
    raw: Record<string, unknown>;
}

/**
 * Provider contract. `MeezanEpgProvider` is the live implementation;
 * `ConsoleEpgProvider` is a dev mock. Refund/reverse are intentionally NOT
 * here yet — they land in a later phase once the bank enables refund.do.
 */
export interface PaymentGatewayProvider {
    registerOrder(params: RegisterOrderParams): Promise<RegisterOrderResult>;
    getOrderStatus(ref: OrderStatusRef): Promise<OrderStatusResult>;
}

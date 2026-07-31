import { Logger } from '@nestjs/common';
import {
    EpgError,
    OrderStatusRef,
    OrderStatusResult,
    PaymentGatewayProvider,
    RegisterOrderParams,
    RegisterOrderResult,
} from './epg.types';

export interface MeezanEpgConfig {
    /** REST base ending in `/payment/rest/` (trailing slash normalised). */
    baseUrl: string;
    /** API (merchant) username — NOT the `_gui` portal login. */
    userName: string;
    password: string;
    /** ISO 4217 numeric currency; PKR = 586. */
    currency: string;
    /** Per-request timeout in ms. */
    timeoutMs: number;
    /** ISO 639-1 default language. */
    defaultLanguage: string;
}

/**
 * Live Meezan Bank EPG provider.
 *
 * Transport mirrors the house convention (FbrService.post): global `fetch`
 * with an AbortController timeout, manual `res.status >= 400` check (fetch does
 * not throw on 4xx/5xx), and a typed EpgError per failure mode.
 *
 * Wire format specifics (from the EPG 1.32 REST spec):
 *  - Requests are `application/x-www-form-urlencoded` GET/POST params. We use
 *    POST so credentials never land in access logs.
 *  - Responses are JSON. `errorCode` "0" (or absent) == success; anything else
 *    is a gateway business error.
 *  - `amount` is in the minor unit (paisa). This provider is the SINGLE place
 *    the major->minor conversion happens.
 */
export class MeezanEpgProvider implements PaymentGatewayProvider {
    private readonly logger = new Logger('MeezanEpg');
    private readonly base: string;

    constructor(private readonly config: MeezanEpgConfig) {
        if (!config.baseUrl || !config.userName || !config.password) {
            throw new EpgError(
                'EPG_CONFIG_ERROR',
                'Meezan EPG is selected but MEEZAN_EPG_BASE_URL / MEEZAN_EPG_USERNAME / MEEZAN_EPG_PASSWORD are not all set',
            );
        }
        this.base = config.baseUrl.endsWith('/')
            ? config.baseUrl
            : `${config.baseUrl}/`;
    }

    async registerOrder(
        params: RegisterOrderParams,
    ): Promise<RegisterOrderResult> {
        const amountPaisa = this.toPaisa(params.amountMajor);
        const form = new URLSearchParams();
        form.set('userName', this.config.userName);
        form.set('password', this.config.password);
        form.set('orderNumber', params.orderNumber);
        form.set('amount', String(amountPaisa));
        form.set('currency', this.config.currency);
        form.set('returnUrl', params.returnUrl);
        if (params.failUrl) form.set('failUrl', params.failUrl);
        if (params.description) form.set('description', params.description);
        form.set('language', params.language ?? this.config.defaultLanguage);

        const body = await this.post('register.do', form);
        this.assertNoGatewayError(body, 'register.do');

        const bankOrderId = this.str(body.orderId ?? body.OrderId);
        const formUrl = this.str(body.formUrl ?? body.FormUrl);
        if (!bankOrderId || !formUrl) {
            throw new EpgError(
                'EPG_INVALID_RESPONSE',
                'register.do succeeded but returned no orderId/formUrl',
            );
        }
        return { bankOrderId, formUrl };
    }

    async getOrderStatus(ref: OrderStatusRef): Promise<OrderStatusResult> {
        if (!ref.bankOrderId && !ref.orderNumber) {
            throw new EpgError(
                'EPG_CONFIG_ERROR',
                'getOrderStatus requires bankOrderId or orderNumber',
            );
        }
        const form = new URLSearchParams();
        form.set('userName', this.config.userName);
        form.set('password', this.config.password);
        // orderId has priority at the bank if both are present; send only one.
        if (ref.bankOrderId) form.set('orderId', ref.bankOrderId);
        else form.set('orderNumber', ref.orderNumber!);
        form.set('language', this.config.defaultLanguage);

        const body = await this.post('getOrderStatusExtended.do', form);
        this.assertNoGatewayError(body, 'getOrderStatusExtended.do');

        // Casing varies across EPG endpoints/versions; read both spellings.
        const orderStatus =
            this.num(body.orderStatus ?? body.OrderStatus) ?? -1;
        const pai =
            body.paymentAmountInfo && typeof body.paymentAmountInfo === 'object'
                ? (body.paymentAmountInfo as Record<string, unknown>)
                : undefined;

        return {
            orderStatus,
            orderNumber: this.str(body.orderNumber ?? body.OrderNumber),
            amountMinor: this.num(body.amount ?? body.Amount),
            currency: this.str(body.currency ?? body.Currency),
            actionCode: this.num(body.actionCode),
            actionCodeDescription: this.str(body.actionCodeDescription),
            approvedAmountMinor: pai ? this.num(pai.approvedAmount) : undefined,
            depositedAmountMinor: pai
                ? this.num(pai.depositedAmount)
                : undefined,
            refundedAmountMinor: pai ? this.num(pai.refundedAmount) : undefined,
            raw: body,
        };
    }

    // --- internals -------------------------------------------------------

    /** MAJOR (rupees) -> MINOR (paisa). The single conversion boundary. */
    private toPaisa(major: number): number {
        if (typeof major !== 'number' || !Number.isFinite(major) || major < 0) {
            throw new EpgError(
                'EPG_CONFIG_ERROR',
                `Invalid amount for EPG: ${String(major)}`,
            );
        }
        // Round away float dust (e.g. 123.45 * 100 -> 12344.999...).
        return Math.round(major * 100);
    }

    private async post(
        method: string,
        form: URLSearchParams,
    ): Promise<Record<string, unknown>> {
        const url = `${this.base}${method}`;
        const controller = new AbortController();
        const timer = setTimeout(
            () => controller.abort(),
            this.config.timeoutMs,
        );
        let res: Response;
        try {
            res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Accept: 'application/json',
                },
                body: form.toString(),
                signal: controller.signal,
            });
        } catch (e) {
            throw new EpgError(
                'EPG_CONNECTION_ERROR',
                `Unable to reach Meezan EPG ${method} (${(e as Error).message}) — network issue, timeout, or gateway down`,
            );
        } finally {
            clearTimeout(timer);
        }

        if (res.status >= 400) {
            throw new EpgError(
                'EPG_HTTP_ERROR',
                `Meezan EPG ${method} responded HTTP ${res.status}`,
            );
        }

        const text = await res.text();
        let parsed: unknown;
        try {
            parsed = JSON.parse(text);
        } catch {
            throw new EpgError(
                'EPG_INVALID_RESPONSE',
                `Meezan EPG ${method} returned non-JSON: ${text.slice(0, 200)}`,
            );
        }
        if (parsed == null || typeof parsed !== 'object') {
            throw new EpgError(
                'EPG_INVALID_RESPONSE',
                `Meezan EPG ${method} returned an empty response`,
            );
        }
        return parsed as Record<string, unknown>;
    }

    /** Throw EPG_GATEWAY_ERROR when the response carries a non-zero errorCode. */
    private assertNoGatewayError(
        body: Record<string, unknown>,
        method: string,
    ): void {
        // Some success responses omit errorCode entirely, or send "0" — both ok.
        const code = this.str(body.errorCode ?? body.ErrorCode);
        if (code === '' || code === '0') return;
        const msg =
            this.str(body.errorMessage ?? body.ErrorMessage) ||
            `Meezan EPG error ${code}`;
        throw new EpgError('EPG_GATEWAY_ERROR', `${method}: ${msg}`, code);
    }

    private str(v: unknown): string {
        if (typeof v === 'string') return v;
        if (typeof v === 'number' || typeof v === 'boolean') return String(v);
        return '';
    }

    private num(v: unknown): number | undefined {
        if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
        if (typeof v === 'string' && v.trim() !== '') {
            const n = Number(v);
            return Number.isFinite(n) ? n : undefined;
        }
        return undefined;
    }
}

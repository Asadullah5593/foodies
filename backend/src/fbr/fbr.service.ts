import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Branch } from '../entities/branch.entity';
import { Order } from '../entities/order.entity';

/**
 * FBR (Federal Board of Revenue, Pakistan) POS fiscalization.
 *
 * Modeled on the field-proven Skechers integration: every finalized sale is
 * POSTed to FBR's IMS endpoint and FBR answers with a fiscal invoice number
 * that must be printed on the receipt (with a QR the customer can verify in
 * the Tax Asaan app).
 *
 * Where this implementation deliberately DIVERGES from Skechers: an FBR
 * failure never blocks the sale. The order is stamped with the branch's most
 * recent REAL fiscal number as a stand-in ('fallback'), and exactly one
 * background retry is scheduled. When FBR is disabled for the branch there is
 * no call and no retry — the fallback number is stamped directly.
 */

/** Typed failure so callers can log the FBR-specific cause. */
export class FbrError extends Error {
    constructor(
        public readonly code:
            | 'FBR_CONFIG_ERROR'
            | 'FBR_CONNECTION_ERROR'
            | 'FBR_HTTP_ERROR'
            | 'FBR_INVALID_RESPONSE'
            | 'FBR_SERVICE_ERROR'
            | 'FBR_INVALID_INVOICE',
        message: string,
    ) {
        super(message);
        this.name = 'FbrError';
    }
}

/** FBR IMS PaymentMode codes. */
const PAYMENT_MODE = { CASH: 1, CARD: 2, MIXED: 5 } as const;

/**
 * PCT heading 9821.1000 — "services provided by restaurants" — as the default
 * line classification. Override per branch (fbr_pct_code) or via env once the
 * client confirms the code on their FBR registration.
 */
const DEFAULT_PCT_CODE = '98211000';

const LIVE_URL = 'https://gw.fbr.gov.pk/imsp/v1/api/Live/PostData';
const SANDBOX_URL = 'https://esp.fbr.gov.pk:8244/FBR/v1/api/Live/PostData';

type FbrLine = {
    ItemCode: string;
    ItemName: string;
    Quantity: number;
    PCTCode: string;
    TaxRate: number;
    SaleValue: number;
    TotalAmount: number;
    TaxCharged: number;
    Discount: number;
    FurtherTax: number;
    InvoiceType: number;
    RefUSIN: null;
};

export type FbrInvoicePayload = {
    InvoiceNumber: string;
    POSID: string;
    USIN: string;
    BuyerNTN: string;
    BuyerCNIC: string;
    DateTime: string;
    BuyerName: string;
    BuyerPhoneNumber: string;
    TotalBillAmount: number;
    TotalQuantity: number;
    TotalSaleValue: number;
    TotalTaxCharged: number;
    Discount: number;
    FurtherTax: number;
    PaymentMode: number;
    RefUSIN: null;
    InvoiceType: number;
    Items: FbrLine[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class FbrService {
    private readonly logger = new Logger(FbrService.name);
    /** Order ids that already consumed their single background retry. */
    private readonly retried = new Set<number>();

    constructor(
        @InjectRepository(Order) private orderRepo: Repository<Order>,
        @InjectRepository(Branch) private branchRepo: Repository<Branch>,
    ) {}

    private apiUrl(environment: string): string {
        if (environment === 'live') return process.env.FBR_LIVE_URL || LIVE_URL;
        return process.env.FBR_SANDBOX_URL || SANDBOX_URL;
    }

    private timeoutMs(): number {
        const n = Number(process.env.FBR_TIMEOUT_MS);
        return Number.isFinite(n) && n > 0 ? n : 10_000;
    }

    private retryDelayMs(): number {
        const n = Number(process.env.FBR_RETRY_DELAY_MS);
        return Number.isFinite(n) && n > 0 ? n : 60_000;
    }

    /**
     * Fiscalize one just-created order. Never throws and never blocks the sale
     * beyond one bounded HTTP attempt: every failure path degrades to the
     * fallback number. Call after the order and its items are fully saved.
     */
    async fiscalizeOrder(orderId: number): Promise<void> {
        try {
            const order = await this.loadOrder(orderId);
            if (!order?.branch) return;
            const branch = order.branch;

            if (!branch.fbrEnabled) {
                // Disabled = no call and NO retry; just reuse the last real number.
                await this.stampFallback(order);
                return;
            }
            if (!branch.fbrPosId?.trim() || !branch.fbrToken?.trim()) {
                // Enabled but unconfigured. A retry can't succeed until an admin
                // fixes the settings, so fall back without scheduling one.
                this.logger.error(
                    `FBR enabled but credentials missing for branch ${branch.id}; order ${orderId} gets a fallback number`,
                );
                await this.stampFallback(order);
                return;
            }

            try {
                const fbrNumber = await this.postInvoice(order, branch);
                await this.orderRepo.update(order.id, {
                    fbrInvoiceNumber: fbrNumber,
                    fbrNumberSource: 'fbr',
                });
                this.logger.log(
                    `FBR invoice ${fbrNumber} recorded for order ${order.id} (branch ${branch.id})`,
                );
            } catch (e) {
                const err = e as FbrError;
                this.logger.warn(
                    `FBR post failed for order ${order.id} (branch ${branch.id}, ${err.name === 'FbrError' ? err.code : 'UNEXPECTED'}): ${err.message} — using fallback number and scheduling one retry`,
                );
                await this.stampFallback(order);
                this.scheduleRetry(order.id);
            }
        } catch (e) {
            this.logger.error(
                `FBR fiscalization crashed for order ${orderId}`,
                e instanceof Error ? e.stack : undefined,
            );
        }
    }

    /**
     * The single background retry. Re-checks state at fire time: skips when FBR
     * was disabled meanwhile or the order already holds a real number.
     */
    private scheduleRetry(orderId: number): void {
        if (this.retried.has(orderId)) return;
        this.retried.add(orderId);
        const timer = setTimeout(() => {
            void (async () => {
                try {
                    const order = await this.loadOrder(orderId);
                    const branch = order?.branch;
                    if (!order || !branch) return;
                    if (order.fbrNumberSource === 'fbr') return;
                    if (
                        !branch.fbrEnabled ||
                        !branch.fbrPosId?.trim() ||
                        !branch.fbrToken?.trim()
                    )
                        return;
                    const fbrNumber = await this.postInvoice(order, branch);
                    await this.orderRepo.update(order.id, {
                        fbrInvoiceNumber: fbrNumber,
                        fbrNumberSource: 'fbr',
                    });
                    this.logger.log(
                        `FBR retry succeeded for order ${order.id}: ${fbrNumber}`,
                    );
                } catch (e) {
                    this.logger.warn(
                        `FBR retry failed for order ${orderId}; keeping fallback number: ${(e as Error).message}`,
                    );
                } finally {
                    // Retries are once-per-order for the process lifetime, but
                    // don't let the set grow unbounded.
                    if (this.retried.size > 10_000) this.retried.clear();
                }
            })();
        }, this.retryDelayMs());
        // Don't hold the process open (graceful shutdown, tests).
        timer.unref?.();
    }

    /** Latest number FBR actually issued for this branch (never a fallback). */
    async latestRealFbrNumber(branchId: number): Promise<string | null> {
        const last = await this.orderRepo.findOne({
            where: { branchId, fbrNumberSource: 'fbr' },
            order: { id: 'DESC' },
            select: { id: true, fbrInvoiceNumber: true },
        });
        return last?.fbrInvoiceNumber ?? null;
    }

    /**
     * Stamp the branch's most recent real FBR number as this order's display
     * number. No previous real number → nothing stamped (receipt omits FBR).
     */
    private async stampFallback(order: Order): Promise<void> {
        if (order.fbrNumberSource === 'fbr') return;
        const fallback = await this.latestRealFbrNumber(order.branchId);
        if (!fallback) return;
        await this.orderRepo.update(order.id, {
            fbrInvoiceNumber: fallback,
            fbrNumberSource: 'fallback',
        });
    }

    private loadOrder(orderId: number): Promise<Order | null> {
        return this.orderRepo.findOne({
            where: { id: orderId },
            relations: ['orderItems', 'payments', 'branch'],
        });
    }

    /** POST one order to FBR; returns the fiscal invoice number. Throws FbrError. */
    private async postInvoice(order: Order, branch: Branch): Promise<string> {
        const payload = this.buildPayload(order, branch);
        const body = await this.post(
            this.apiUrl(branch.fbrEnvironment),
            branch.fbrToken!.trim(),
            payload,
        );
        return this.extractInvoiceNumber(body);
    }

    private async post(
        url: string,
        token: string,
        payload: unknown,
    ): Promise<Record<string, unknown>> {
        // Admins naturally paste the token either bare or as FBR hands it out
        // ("Bearer <uuid>"). Strip any leading scheme so we never double it up.
        const bearer = token.trim().replace(/^bearer\s+/i, '');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs());
        let res: Response;
        try {
            res = await fetch(url, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${bearer}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
                signal: controller.signal,
            });
        } catch (e) {
            throw new FbrError(
                'FBR_CONNECTION_ERROR',
                `Unable to reach FBR (${(e as Error).message}) — network issue or FBR service down`,
            );
        } finally {
            clearTimeout(timer);
        }
        if (res.status >= 400) {
            throw new FbrError(
                'FBR_HTTP_ERROR',
                `FBR responded HTTP ${res.status}`,
            );
        }
        let body: unknown;
        try {
            body = await res.json();
        } catch {
            throw new FbrError(
                'FBR_INVALID_RESPONSE',
                'FBR returned a non-JSON response',
            );
        }
        if (body == null || typeof body !== 'object') {
            throw new FbrError(
                'FBR_INVALID_RESPONSE',
                'FBR returned an empty response',
            );
        }
        return body as Record<string, unknown>;
    }

    private extractInvoiceNumber(body: Record<string, unknown>): string {
        const invoiceNumber = body.InvoiceNumber;
        if (
            typeof invoiceNumber === 'string' &&
            invoiceNumber.trim() !== '' &&
            invoiceNumber !== 'Not Available'
        ) {
            return invoiceNumber.trim();
        }
        const reported = body.Error ?? body.error ?? body.Message;
        const reportedMsg =
            typeof reported === 'string'
                ? reported
                : reported != null
                  ? JSON.stringify(reported)
                  : '';
        if (reportedMsg.trim() !== '') {
            throw new FbrError('FBR_SERVICE_ERROR', reportedMsg);
        }
        throw new FbrError(
            'FBR_INVALID_INVOICE',
            'FBR response did not contain a valid invoice number',
        );
    }

    /**
     * Build the FBR IMS invoice payload — same shape the Skechers integration
     * runs in production. Order-level figures are exact; per-line tax is
     * allocated proportionally to the line subtotal with the rounding
     * remainder on the last line.
     */
    buildPayload(order: Order, branch: Branch): FbrInvoicePayload {
        const totalBill = r2(Number(order.totalAmount));
        const totalTax = r2(Number(order.taxAmount));
        const discount = r2(Number(order.discountAmount));
        const taxBase = r2(totalBill - totalTax);
        const taxRatePct = taxBase > 0 ? r2((totalTax / taxBase) * 100) : 0;

        const items = [...(order.orderItems ?? [])].sort((a, b) => a.id - b.id);
        const lineSubtotals = items.map((oi) => r2(Number(oi.subtotal)));
        const subtotalSum = r2(lineSubtotals.reduce((s, n) => s + n, 0));
        const pctCode = (
            branch.fbrPctCode?.trim() ||
            process.env.FBR_DEFAULT_PCT_CODE ||
            DEFAULT_PCT_CODE
        ).trim();

        let taxAllocated = 0;
        const lines: FbrLine[] = items.map((oi, idx) => {
            const saleValue = lineSubtotals[idx];
            const isLast = idx === items.length - 1;
            const taxCharged = isLast
                ? r2(totalTax - taxAllocated)
                : subtotalSum > 0
                  ? r2((saleValue / subtotalSum) * totalTax)
                  : 0;
            taxAllocated = r2(taxAllocated + taxCharged);
            return {
                ItemCode: String(oi.menuItemId ?? oi.id),
                ItemName: oi.nameSnapshot ?? `Item ${oi.menuItemId ?? oi.id}`,
                Quantity: Number(oi.quantity),
                PCTCode: pctCode,
                TaxRate: taxRatePct,
                SaleValue: saleValue,
                TotalAmount: r2(saleValue + taxCharged),
                TaxCharged: taxCharged,
                Discount: 0,
                FurtherTax: 0.0,
                InvoiceType: 1,
                RefUSIN: null,
            };
        });

        const usin = order.orderId ?? String(order.id);
        return {
            InvoiceNumber: usin,
            POSID: branch.fbrPosId!.trim(),
            USIN: usin,
            BuyerNTN: '',
            BuyerCNIC: '',
            DateTime: this.formatDateTime(
                order.placedAt ?? new Date(),
                branch.timezone,
            ),
            BuyerName: order.customerName?.trim() || 'Walk-in Customer',
            BuyerPhoneNumber: order.customerPhone ?? '',
            TotalBillAmount: totalBill,
            TotalQuantity: items.reduce((s, oi) => s + Number(oi.quantity), 0),
            TotalSaleValue: taxBase,
            TotalTaxCharged: totalTax,
            Discount: discount,
            FurtherTax: 0.0,
            PaymentMode: this.paymentMode(order),
            RefUSIN: null,
            InvoiceType: 1,
            Items: lines,
        };
    }

    /**
     * FBR PaymentMode: 1 cash, 2 card, 5 mixed. Payments are recorded AFTER
     * order creation, so at fiscalization time the tender intent lives in
     * order.taxBasis (stamped from the payment split at placement); recorded
     * payments are the fallback for the background retry path.
     */
    private paymentMode(order: Order): number {
        if (order.taxBasis === 'card') return PAYMENT_MODE.CARD;
        if (order.taxBasis === 'split') return PAYMENT_MODE.MIXED;
        if (order.taxBasis === 'cash') return PAYMENT_MODE.CASH;
        const methods = new Set(
            (order.payments ?? [])
                .filter((p) => p.status === 'completed')
                .map((p) => (p.paymentMethod || '').toLowerCase()),
        );
        const hasCash = methods.has('cash');
        const hasNonCash = [...methods].some((m) => m && m !== 'cash');
        if (hasCash && hasNonCash) return PAYMENT_MODE.MIXED;
        if (hasNonCash) return PAYMENT_MODE.CARD;
        return PAYMENT_MODE.CASH;
    }

    /** 'YYYY-MM-DD HH:mm:ss' in the branch's timezone (defaults to Karachi). */
    private formatDateTime(date: Date, timezone?: string | null): string {
        const tz = timezone && timezone !== 'UTC' ? timezone : 'Asia/Karachi';
        try {
            const parts = new Intl.DateTimeFormat('en-CA', {
                timeZone: tz,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false,
            }).formatToParts(date);
            const get = (type: string) =>
                parts.find((p) => p.type === type)?.value ?? '00';
            return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
        } catch {
            return date.toISOString().slice(0, 19).replace('T', ' ');
        }
    }

    // ------------------------------------------------------------------
    // Admin: status, bulk toggle, test connection
    // ------------------------------------------------------------------

    private tenantBranchesQb(tenantId: number | null) {
        // Filter by tenant via EXISTS rather than a join: a branch has many
        // brands, so joining would emit duplicate branch rows, and de-duping
        // with SELECT DISTINCT fails — branches.settings is a `json` column and
        // Postgres has no equality operator for `json`.
        const qb = this.branchRepo.createQueryBuilder('b');
        if (tenantId != null) {
            qb.where(
                'EXISTS (SELECT 1 FROM branch_brands bb ' +
                    'INNER JOIN brands br ON br.id = bb.brand_id ' +
                    'WHERE bb.branch_id = b.id AND br.tenant_id = :tenantId)',
                { tenantId },
            );
        }
        return qb;
    }

    /** Per-branch FBR overview for the Business Settings panel. */
    async getStatus(tenantId: number | null) {
        const branches = await this.tenantBranchesQb(tenantId)
            .orderBy('b.name', 'ASC')
            .getMany();
        const rows = branches.map((b) => ({
            id: b.id,
            name: b.name,
            fbr_enabled: b.fbrEnabled,
            fbr_environment: b.fbrEnvironment,
            has_credentials: !!(b.fbrPosId?.trim() && b.fbrToken?.trim()),
        }));
        return {
            total_branches: rows.length,
            enabled_branches: rows.filter((r) => r.fbr_enabled).length,
            branches: rows,
        };
    }

    /**
     * The admin "all branches at once" button: rewrites every branch's own
     * fbr_enabled flag (bulk semantics — there is no separate global state).
     * Enabling skips branches with no credentials; they'd only produce
     * guaranteed-failing calls until configured.
     */
    async bulkSetEnabled(tenantId: number | null, enabled: boolean) {
        const branches = await this.tenantBranchesQb(tenantId).getMany();
        const targets = enabled
            ? branches.filter((b) => b.fbrPosId?.trim() && b.fbrToken?.trim())
            : branches;
        const skipped = enabled ? branches.length - targets.length : 0;
        if (targets.length > 0) {
            await this.branchRepo.update(
                targets.map((b) => b.id),
                { fbrEnabled: enabled },
            );
        }
        return {
            updated: targets.length,
            skipped_missing_credentials: skipped,
            enabled,
        };
    }

    /**
     * Post a Skechers-style dummy invoice to verify credentials/connectivity.
     * Uses the branch's configured environment; run against sandbox unless the
     * client explicitly wants a live probe.
     */
    async testConnection(branchId: number, tenantId: number | null) {
        const branch = await this.tenantBranchesQb(tenantId)
            .andWhere('b.id = :branchId', { branchId })
            .getOne();
        if (!branch) throw new NotFoundException('Branch not found');
        if (!branch.fbrPosId?.trim() || !branch.fbrToken?.trim()) {
            return {
                success: false,
                msg: 'FBR POS ID and token must be saved before testing.',
            };
        }
        const testPayload: FbrInvoicePayload = {
            InvoiceNumber: `TEST-${Date.now()}`,
            POSID: branch.fbrPosId.trim(),
            USIN: `TEST-${Date.now()}`,
            BuyerNTN: '',
            BuyerCNIC: '',
            DateTime: this.formatDateTime(new Date(), branch.timezone),
            BuyerName: 'Test Customer',
            BuyerPhoneNumber: '03001234567',
            TotalBillAmount: 100,
            TotalQuantity: 1,
            TotalSaleValue: 100,
            TotalTaxCharged: 0,
            Discount: 0,
            FurtherTax: 0.0,
            PaymentMode: PAYMENT_MODE.CASH,
            RefUSIN: null,
            InvoiceType: 1,
            Items: [
                {
                    ItemCode: 'TEST001',
                    ItemName: 'Test Item',
                    Quantity: 1,
                    PCTCode: (
                        branch.fbrPctCode?.trim() ||
                        process.env.FBR_DEFAULT_PCT_CODE ||
                        DEFAULT_PCT_CODE
                    ).trim(),
                    TaxRate: 0,
                    SaleValue: 100,
                    TotalAmount: 100,
                    TaxCharged: 0,
                    Discount: 0,
                    FurtherTax: 0.0,
                    InvoiceType: 1,
                    RefUSIN: null,
                },
            ],
        };
        try {
            const body = await this.post(
                this.apiUrl(branch.fbrEnvironment),
                branch.fbrToken.trim(),
                testPayload,
            );
            const invoiceNumber = this.extractInvoiceNumber(body);
            return {
                success: true,
                msg: `FBR connection OK — test invoice number: ${invoiceNumber}`,
            };
        } catch (e) {
            const err = e as FbrError;
            return {
                success: false,
                msg:
                    err.name === 'FbrError'
                        ? `${err.code}: ${err.message}`
                        : `Connection test failed: ${err.message}`,
            };
        }
    }
}

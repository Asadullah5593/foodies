import { OfferSettings } from './offer-settings';

/**
 * Pure staged-pricing core. It does NOT know about eligibility (branch/brand/
 * time/scope/BOGO) — the caller resolves which offers apply and passes, per
 * stage, a `compute(running)` callback that returns the raw desired discount
 * for each line given the CURRENT running per-line amounts (so percentage
 * offers compound correctly). The engine enforces the cross-cutting rules:
 * fixed stacking order, deal / price-override exclusion, per-line floors
 * (0 + cost), and the progressive max-total-discount cap with funding
 * exemptions. Loyalty (S5) is applied by the caller using `capRemaining`.
 */

export type OfferStageKind =
  | 'product_promotion'
  | 'discount'
  | 'staff_discount'
  | 'coupon'
  | 'card_offer';

export interface EngineLine {
  /** Original sell subtotal for the line (qty × unit sell price). */
  itemSubtotal: number;
  /** Total cost for the line (unitCost × qty); null = unknown → no cost floor. */
  lineCost: number | null;
  /** Deal-derived line — excluded from all offers unless allowOffersOnDeals. */
  isDeal: boolean;
  /** POS price-overridden line — excluded from offers unless offersApplyToOverriddenLines. */
  isOverridden: boolean;
}

export interface EngineStage {
  kind: OfferStageKind;
  funding: 'merchant' | 'bank';
  /**
   * Ignore the per-line "never below cost" floor for this stage. Set only by
   * the staff-discount stage: a give-away granted by hand is a deliberate
   * write-off of margin, so silently stopping it at cost would hand the
   * customer less than the cashier promised. Automatic offers keep the floor —
   * nobody chose those line by line.
   */
  bypassesCostFloor?: boolean;
  /**
   * Given the current running per-line amounts (post previous stages), return
   * the raw desired discount for each line (index-aligned). Percentage offers
   * should compute against `running[i]`, flat/whole-order offers should
   * pre-allocate pro-rata across their in-scope lines.
   */
  compute: (running: number[]) => number[];
}

export interface EngineLineResult {
  original: number;
  discounts: { kind: OfferStageKind; amount: number }[];
  totalDiscount: number;
  after: number;
}

export interface EngineResult {
  lines: EngineLineResult[];
  /** Total discount booked per stage kind. */
  byKind: Record<OfferStageKind, number>;
  totalDiscount: number;
  /** Effective cap for the order (null = no cap). */
  capTotal: number | null;
  /** Discount booked so far that counts toward the cap. */
  merchantSpent: number;
  /** Remaining cap budget for loyalty (null = no cap). */
  capRemaining: number | null;
  /** True if the cap clamped any stage. */
  capApplied: boolean;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function runOfferEngine(
  lines: EngineLine[],
  stages: EngineStage[],
  settings: OfferSettings,
): EngineResult {
  const n = lines.length;
  const running = lines.map((l) => l.itemSubtotal);
  const perLine: { kind: OfferStageKind; amount: number }[][] = lines.map(
    () => [],
  );
  const byKind: Record<OfferStageKind, number> = {
    product_promotion: 0,
    discount: 0,
    staff_discount: 0,
    coupon: 0,
    card_offer: 0,
  };

  const excluded = lines.map(
    (l) =>
      (l.isDeal && !settings.allowOffersOnDeals) ||
      (l.isOverridden && !settings.offersApplyToOverriddenLines),
  );

  const floorFor = (i: number): number => {
    const l = lines[i];
    if (!settings.costFloorEnabled) return 0;
    if (l.isOverridden && settings.priceOverrideBypassesCostFloor) return 0;
    if (l.lineCost == null) return 0;
    return Math.max(0, l.lineCost);
  };

  // Cap base — Option B (non-deal) by default.
  const capBase = lines.reduce((sum, l) => {
    if (settings.maxTotalDiscountBase === 'full_subtotal') {
      return sum + l.itemSubtotal;
    }
    return sum + (l.isDeal ? 0 : l.itemSubtotal);
  }, 0);
  let capTotal: number | null = null;
  if (settings.maxTotalDiscountPercent != null) {
    capTotal = round2((capBase * settings.maxTotalDiscountPercent) / 100);
  }
  if (settings.maxTotalDiscountAmount != null) {
    capTotal =
      capTotal == null
        ? settings.maxTotalDiscountAmount
        : Math.min(capTotal, settings.maxTotalDiscountAmount);
  }

  let merchantSpent = 0;
  let capApplied = false;

  for (const stage of stages) {
    const raw = stage.compute(running.slice());
    // Clamp each line to its floor + exclusion.
    let alloc = raw.map((d, i) => {
      if (excluded[i]) return 0;
      const floor = stage.bypassesCostFloor ? 0 : floorFor(i);
      const maxByFloor = Math.max(0, round2(running[i] - floor));
      const desired = Math.max(0, d ?? 0);
      return round2(Math.min(desired, maxByFloor));
    });

    // Progressive cap: only stages that count toward the cap are limited.
    const countsTowardCap =
      stage.funding === 'merchant' ||
      (stage.kind === 'card_offer' && settings.capIncludesCardOffers);
    if (capTotal != null && countsTowardCap) {
      const stageTotal = alloc.reduce((s, x) => s + x, 0);
      const capRemaining = Math.max(0, round2(capTotal - merchantSpent));
      if (stageTotal > capRemaining + 1e-9) {
        capApplied = true;
        const factor = stageTotal > 0 ? capRemaining / stageTotal : 0;
        alloc = alloc.map((x) => round2(x * factor));
      }
    }

    let stageBooked = 0;
    for (let i = 0; i < n; i++) {
      if (alloc[i] > 0) {
        running[i] = round2(running[i] - alloc[i]);
        perLine[i].push({ kind: stage.kind, amount: alloc[i] });
        byKind[stage.kind] = round2(byKind[stage.kind] + alloc[i]);
        stageBooked += alloc[i];
      }
    }
    if (countsTowardCap) merchantSpent = round2(merchantSpent + stageBooked);
  }

  const lineResults: EngineLineResult[] = lines.map((l, i) => {
    const total = round2(perLine[i].reduce((s, d) => s + d.amount, 0));
    return {
      original: l.itemSubtotal,
      discounts: perLine[i],
      totalDiscount: total,
      after: round2(l.itemSubtotal - total),
    };
  });
  const totalDiscount = round2(
    lineResults.reduce((s, r) => s + r.totalDiscount, 0),
  );
  const capRemaining =
    capTotal == null ? null : Math.max(0, round2(capTotal - merchantSpent));

  return {
    lines: lineResults,
    byKind,
    totalDiscount,
    capTotal,
    merchantSpent,
    capRemaining,
    capApplied,
  };
}

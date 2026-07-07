import {
  runOfferEngine,
  EngineLine,
  EngineStage,
  round2,
} from './offer-engine';
import { resolveOfferSettings, DEFAULT_OFFER_SETTINGS } from './offer-settings';

// ---- helpers ---------------------------------------------------------------

const line = (
  itemSubtotal: number,
  opts: Partial<EngineLine> = {},
): EngineLine => ({
  itemSubtotal,
  lineCost: opts.lineCost ?? null,
  isDeal: opts.isDeal ?? false,
  isOverridden: opts.isOverridden ?? false,
});

/** A flat amount applied to a single line index (pro-rata done by caller normally). */
const flatOn = (
  kind: EngineStage['kind'],
  amount: number,
  idx: number,
  n: number,
  funding: 'merchant' | 'bank' = 'merchant',
): EngineStage => ({
  kind,
  funding,
  compute: () => Array.from({ length: n }, (_, i) => (i === idx ? amount : 0)),
});

/** A percentage applied to every line's running amount. */
const pct = (
  kind: EngineStage['kind'],
  percent: number,
  funding: 'merchant' | 'bank' = 'merchant',
): EngineStage => ({
  kind,
  funding,
  compute: (running) => running.map((r) => round2((r * percent) / 100)),
});

// ---------------------------------------------------------------------------

describe('offer-engine', () => {
  describe('E8 — percentage compounding order', () => {
    it('10% promo then 10% discount on 100 = 81 (not 80)', () => {
      const res = runOfferEngine(
        [line(100)],
        [pct('product_promotion', 10), pct('discount', 10)],
        resolveOfferSettings(null),
      );
      expect(res.lines[0].after).toBe(81);
      expect(res.totalDiscount).toBe(19);
    });
  });

  describe('E4 — deals are excluded from every offer', () => {
    it('a 10% discount touches only the non-deal line', () => {
      const res = runOfferEngine(
        [line(499, { isDeal: true }), line(800)],
        [pct('discount', 10)],
        resolveOfferSettings(null),
      );
      expect(res.lines[0].after).toBe(499); // deal untouched
      expect(res.lines[1].after).toBe(720); // 800 − 80
      expect(res.totalDiscount).toBe(80);
    });

    it('allowOffersOnDeals=true lets the deal be discounted', () => {
      const res = runOfferEngine(
        [line(499, { isDeal: true }), line(800)],
        [pct('discount', 10)],
        resolveOfferSettings({ allowOffersOnDeals: true }),
      );
      expect(res.lines[0].after).toBe(round2(499 * 0.9));
      expect(res.lines[1].after).toBe(720);
    });
  });

  describe('E9 — cost floor clamp', () => {
    it('a discount cannot push a line below its cost', () => {
      const res = runOfferEngine(
        [line(100, { lineCost: 90 })],
        [pct('product_promotion', 10), flatOn('discount', 20, 0, 1)],
        resolveOfferSettings(null),
      );
      // promo 10% → 90 (== floor), discount clamped to 0
      expect(res.lines[0].after).toBe(90);
      expect(res.byKind.product_promotion).toBe(10);
      expect(res.byKind.discount).toBe(0);
    });

    it('costFloorEnabled=false allows below-cost', () => {
      const res = runOfferEngine(
        [line(100, { lineCost: 90 })],
        [flatOn('discount', 40, 0, 1)],
        resolveOfferSettings({ costFloorEnabled: false }),
      );
      expect(res.lines[0].after).toBe(60);
    });
  });

  describe('E7 — full stack + cap + funding flag (Product A: 100, cost 40, cap 50%)', () => {
    const stages = (): EngineStage[] => [
      flatOn('product_promotion', 10, 0, 1),
      flatOn('discount', 10, 0, 1),
      flatOn('coupon', 10, 0, 1),
      pct('card_offer', 10, 'bank'), // 10% of running 70 = 7
    ];

    it('card exempt from cap (default): offers total 37, merchantSpent 30, capRemaining 20', () => {
      const res = runOfferEngine(
        [line(100, { lineCost: 40 })],
        stages(),
        resolveOfferSettings({ maxTotalDiscountPercent: 50 }),
      );
      expect(res.lines[0].after).toBe(63); // 100→90→80→70→63
      expect(res.byKind.card_offer).toBe(7);
      expect(res.merchantSpent).toBe(30); // promo+discount+coupon
      expect(res.capRemaining).toBe(20); // 50 − 30  → loyalty budget
      expect(res.capApplied).toBe(false);
    });

    it('capIncludesCardOffers=true: card counts, merchantSpent 37, capRemaining 13', () => {
      const res = runOfferEngine(
        [line(100, { lineCost: 40 })],
        stages(),
        resolveOfferSettings({
          maxTotalDiscountPercent: 50,
          capIncludesCardOffers: true,
        }),
      );
      expect(res.lines[0].after).toBe(63);
      expect(res.merchantSpent).toBe(37);
      expect(res.capRemaining).toBe(13); // loyalty clamped to 13 → final 50
    });

    it('cap clamps a merchant stage that would exceed the budget', () => {
      // cap 50% of 100 = 50; three merchant flats of 20 each = 60 desired
      const res = runOfferEngine(
        [line(100)],
        [
          flatOn('product_promotion', 20, 0, 1),
          flatOn('discount', 20, 0, 1),
          flatOn('coupon', 20, 0, 1),
        ],
        resolveOfferSettings({ maxTotalDiscountPercent: 50 }),
      );
      expect(res.merchantSpent).toBe(50);
      expect(res.totalDiscount).toBe(50);
      expect(res.capApplied).toBe(true);
      expect(res.lines[0].after).toBe(50);
    });
  });

  describe('price override', () => {
    it('overridden line skips offers by default and bypasses cost floor', () => {
      const res = runOfferEngine(
        [line(100, { lineCost: 90, isOverridden: true })],
        [pct('discount', 10)],
        resolveOfferSettings(null),
      );
      expect(res.lines[0].after).toBe(100); // offer skipped
      expect(res.totalDiscount).toBe(0);
    });

    it('offersApplyToOverriddenLines=true lets offers apply', () => {
      const res = runOfferEngine(
        [line(100, { lineCost: 90, isOverridden: true })],
        [pct('discount', 10)],
        resolveOfferSettings({ offersApplyToOverriddenLines: true }),
      );
      expect(res.lines[0].after).toBe(90);
    });
  });

  describe('resolveOfferSettings', () => {
    it('null → defaults (cap off, deals excluded, Option B base)', () => {
      const s = resolveOfferSettings(null);
      expect(s).toEqual(DEFAULT_OFFER_SETTINGS);
      expect(s.maxTotalDiscountPercent).toBeNull();
      expect(s.maxTotalDiscountBase).toBe('non_deal_subtotal');
      expect(s.allowOffersOnDeals).toBe(false);
    });
    it('partial overrides merge over defaults', () => {
      const s = resolveOfferSettings({ maxTotalDiscountPercent: 40 });
      expect(s.maxTotalDiscountPercent).toBe(40);
      expect(s.capIncludesCardOffers).toBe(false); // default preserved
    });
  });
});

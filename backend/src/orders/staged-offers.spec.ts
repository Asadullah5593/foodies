import { OrdersService } from './orders.service';
import { resolveOfferSettings } from './offer-settings';

/**
 * Exercises the real staged orchestration (evalOfferOnRunning + resolveStagedOffers)
 * — the S1→S4 stacking the pure offer-engine tests don't cover — by driving a
 * prototype instance with mocked repositories.
 */
type AnyOffer = Record<string, unknown>;

const mkOffer = (o: AnyOffer): AnyOffer => ({
  id: 1,
  requiresCode: false,
  type: 'flat',
  applicationScope: 'whole_order',
  applicationScopeIds: null,
  eligibilityBranchIds: null,
  eligibilityBrandIds: null,
  requiresCard: false,
  eligibleBankCardIds: null,
  minOrderAmount: null,
  maxDiscountAmount: null,
  validFrom: null,
  validUntil: null,
  posOnly: false,
  code: null,
  funding: 'merchant',
  ...o,
});

function svcWith(autoOffers: AnyOffer[], coupon: AnyOffer | null): OrdersService {
  const svc = Object.create(OrdersService.prototype) as OrdersService & {
    discountRepo: unknown;
    isDiscountValidForBranchTime: unknown;
  };
  svc.discountRepo = {
    find: async () => autoOffers,
    findOne: async () => coupon,
  };
  svc.isDiscountValidForBranchTime = async () => true;
  return svc as OrdersService;
}

const lineA = {
  menuItemId: 55,
  categoryId: 1,
  itemSubtotal: 100,
  brandId: 2,
  quantity: 1,
  unitCost: 40,
  isDeal: false,
};

describe('resolveStagedOffers (real orchestration)', () => {
  it('E7 — product promo + discount + coupon + card stack; card exempt from cap', async () => {
    const svc = svcWith(
      [
        mkOffer({
          id: 10,
          offerKind: 'product_promotion',
          type: 'flat',
          value: 10,
          applicationScope: 'products',
          applicationScopeIds: [55],
        }),
        mkOffer({ id: 20, offerKind: 'discount', type: 'flat', value: 10 }),
        mkOffer({
          id: 40,
          offerKind: 'card_offer',
          type: 'percentage',
          value: 10,
          requiresCard: true,
          eligibleBankCardIds: [7],
          funding: 'bank',
        }),
      ],
      mkOffer({
        id: 30,
        offerKind: 'coupon',
        requiresCode: true,
        code: 'SPEND',
        type: 'flat',
        value: 10,
      }),
    );

    const r = await (
      svc as unknown as {
        resolveStagedOffers: (c: unknown) => Promise<Record<string, number>>;
      }
    ).resolveStagedOffers({
      tenantId: 1,
      subtotal: 100,
      source: 'pos',
      branchId: 10,
      orderBrandId: 2,
      lineDetails: [lineA],
      couponCode: 'SPEND',
      fullCardPayment: true,
      bankCardId: 7,
      settings: resolveOfferSettings({ maxTotalDiscountPercent: 50 }),
    });

    expect(r.productPromoAmount).toBe(10);
    expect(r.discountAmount).toBe(10);
    expect(r.couponDiscountAmount).toBe(10);
    expect(r.cardDiscountAmount).toBe(7); // 10% of running 70
    expect(r.autoDiscountAmount).toBe(27); // promo + discount + card
    expect(r.totalDiscount).toBe(37);
    expect(r.capRemaining).toBe(20); // 50 − 30 merchant; card exempt
    expect((r as { discountCode: string }).discountCode).toBe('SPEND');
  });

  it('deal line is excluded; only the non-deal line gets the discount', async () => {
    const svc = svcWith(
      [mkOffer({ id: 20, offerKind: 'discount', type: 'percentage', value: 10 })],
      null,
    );
    const r = await (
      svc as unknown as {
        resolveStagedOffers: (c: unknown) => Promise<{
          combinedLineDiscount: number[];
          totalDiscount: number;
        }>;
      }
    ).resolveStagedOffers({
      tenantId: 1,
      subtotal: 1299,
      source: 'consumer_app',
      branchId: 10,
      orderBrandId: 2,
      lineDetails: [
        { menuItemId: 99, categoryId: 1, itemSubtotal: 499, brandId: 2, quantity: 1, isDeal: true },
        { menuItemId: 55, categoryId: 1, itemSubtotal: 800, brandId: 2, quantity: 1, isDeal: false },
      ],
      couponCode: null,
      fullCardPayment: false,
      bankCardId: null,
      settings: resolveOfferSettings(null),
    });
    expect(r.combinedLineDiscount[0]).toBe(0); // deal untouched
    expect(r.combinedLineDiscount[1]).toBe(80); // 10% of 800
    expect(r.totalDiscount).toBe(80);
  });

  it('card offer does not apply without full card payment', async () => {
    const svc = svcWith(
      [
        mkOffer({
          id: 40,
          offerKind: 'card_offer',
          type: 'percentage',
          value: 10,
          requiresCard: true,
          eligibleBankCardIds: [7],
        }),
      ],
      null,
    );
    const r = await (
      svc as unknown as {
        resolveStagedOffers: (c: unknown) => Promise<{ totalDiscount: number }>;
      }
    ).resolveStagedOffers({
      tenantId: 1,
      subtotal: 100,
      source: 'pos',
      branchId: 10,
      orderBrandId: 2,
      lineDetails: [lineA],
      couponCode: null,
      fullCardPayment: false,
      bankCardId: null,
      settings: resolveOfferSettings(null),
    });
    expect(r.totalDiscount).toBe(0);
  });
});

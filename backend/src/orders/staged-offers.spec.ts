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

/** A bank card carrying its own offer — the only source of card discounts. */
const mkCard = (c: AnyOffer): AnyOffer => ({
  id: 7,
  tenantId: 1,
  name: 'HBL Premium',
  isActive: true,
  discountType: 'percentage',
  discountValue: 10,
  minOrderAmount: null,
  maxDiscountAmount: null,
  validFrom: null,
  validUntil: null,
  validTimeStart: null,
  validTimeEnd: null,
  validDaysOfWeek: null,
  eligibilityBrandIds: null,
  eligibilityBranchIds: null,
  ...c,
});

function svcWith(
  autoOffers: AnyOffer[],
  coupon: AnyOffer | null,
  bankCards: AnyOffer[] = [],
): OrdersService {
  const svc = Object.create(OrdersService.prototype) as OrdersService & {
    discountRepo: unknown;
    bankCardRepo: unknown;
    isDiscountValidForBranchTime: unknown;
  };
  svc.discountRepo = {
    find: async () => autoOffers,
    findOne: async () => coupon,
  };
  svc.bankCardRepo = { find: async () => bankCards };
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
      ],
      mkOffer({
        id: 30,
        offerKind: 'coupon',
        requiresCode: true,
        code: 'SPEND',
        type: 'flat',
        value: 10,
      }),
      [mkCard({ id: 7, discountType: 'percentage', discountValue: 10 })],
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
      [],
      null,
      [mkCard({ id: 7, discountType: 'percentage', discountValue: 10 })],
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

  it('ignores a leftover card_offer row in discounts — cards are the only source', async () => {
    // Card offers moved onto bank_cards. A stale discounts row must not price
    // anything, or a card discount could apply with no card configured to give it.
    const svc = svcWith(
      [
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
      null,
      [],
    );
    const r = await (
      svc as unknown as {
        resolveStagedOffers: (c: unknown) => Promise<{
          totalDiscount: number;
          cardDiscountAmount: number;
        }>;
      }
    ).resolveStagedOffers({
      tenantId: 1,
      subtotal: 100,
      source: 'pos',
      branchId: 10,
      orderBrandId: 2,
      lineDetails: [lineA],
      couponCode: null,
      fullCardPayment: true,
      bankCardId: 7,
      settings: resolveOfferSettings(null),
    });
    expect(r.cardDiscountAmount).toBe(0);
    expect(r.totalDiscount).toBe(0);
  });

  it('never reports a bank card id as the order discount_id', async () => {
    // orders.discount_id is FK-constrained to discounts(id); a card offer's id is
    // a bank_cards id and would point at an unrelated discount.
    const svc = svcWith(
      [],
      null,
      [mkCard({ id: 7, discountType: 'percentage', discountValue: 10 })],
    );
    const r = await (
      svc as unknown as {
        resolveStagedOffers: (c: unknown) => Promise<{
          cardDiscountAmount: number;
          discountId: number | null;
        }>;
      }
    ).resolveStagedOffers({
      tenantId: 1,
      subtotal: 100,
      source: 'pos',
      branchId: 10,
      orderBrandId: 2,
      lineDetails: [lineA],
      couponCode: null,
      fullCardPayment: true,
      bankCardId: 7,
      settings: resolveOfferSettings(null),
    });
    expect(r.cardDiscountAmount).toBe(10);
    expect(r.discountId).toBeNull();
  });
});

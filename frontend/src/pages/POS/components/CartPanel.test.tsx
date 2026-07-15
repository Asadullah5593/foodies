import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import CartPanel, { QuoteLineBreakdown } from './CartPanel';
import { CartLine } from './types';
import { MenuItem } from '../../../types';

vi.mock('../../../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'light' }) }));

const modGroup = (
  id: number,
  name: string,
  mods: Array<{ id: number; name: string; price: number }>,
  includedQuantity = 0,
) => ({
  id,
  name,
  min_select: 0,
  max_select: 5,
  included_quantity: includedQuantity,
  modifiers: mods.map((m) => ({ id: m.id, name: m.name, price: m.price, is_active: true })),
});

const pizza: MenuItem = {
  id: 1,
  category_id: 1,
  name: 'Build Your Own Pizza',
  base_price: 699,
  is_active: true,
  brand_id: 25,
  modifier_groups: [
    // A free choice: priced 0, so it is free by price.
    modGroup(10, 'Choose your Crust', [{ id: 100, name: 'Regular Crust', price: 0 }]),
    // A priced group with a 1-unit allowance: the first pick is free by allowance.
    modGroup(
      11,
      'Extra Toppings',
      [
        { id: 110, name: 'Chicken Pepperoni', price: 250 },
        { id: 111, name: 'Sweetcorn', price: 49 },
      ],
      1,
    ),
  ] as unknown as MenuItem['modifier_groups'],
};

const line = (over: Partial<CartLine> = {}): CartLine => ({
  menuItem: pizza,
  quantity: 1,
  addons: [],
  modifiers: [],
  ...over,
});

const renderCart = (items: CartLine[], lineBreakdown?: QuoteLineBreakdown[] | null) =>
  render(
    <CartPanel
      items={items}
      onUpdateQuantity={vi.fn()}
      onRemoveItem={vi.fn()}
      getBrandName={() => 'Fireaway'}
      lineBreakdown={lineBreakdown}
    />,
  );

describe('CartPanel option rows', () => {
  it('names the modifier group alongside each choice, like the receipt does', () => {
    renderCart([line({ modifiers: [{ modifierId: 100, quantity: 1 }] })]);
    expect(screen.getByText('Choose your Crust: Regular Crust')).toBeInTheDocument();
  });

  it('prices a zero-price choice at 0.00 rather than leaving it blank', () => {
    renderCart([line({ modifiers: [{ modifierId: 100, quantity: 1 }] })]);
    const row = screen.getByText('Choose your Crust: Regular Crust').closest('li')!;
    expect(within(row).getByText('Rs. 0.00')).toBeInTheDocument();
  });

  it('prices an allowance-covered choice at 0.00 instead of saying "Included"', () => {
    renderCart([line({ modifiers: [{ modifierId: 110, quantity: 1 }] })]);
    const row = screen.getByText('Extra Toppings: Chicken Pepperoni').closest('li')!;
    expect(within(row).getByText('Rs. 0.00')).toBeInTheDocument();
    expect(screen.queryByText('Included')).not.toBeInTheDocument();
  });

  it('still charges the picks beyond the allowance and flags how many were free', () => {
    // Allowance is 1: of two Chicken Pepperoni units, one is free and one bills 250.
    renderCart([line({ modifiers: [{ modifierId: 110, quantity: 2 }] })]);
    const row = screen.getByText('Extra Toppings: Chicken Pepperoni ×2').closest('li')!;
    expect(within(row).getByText('Rs. 250.00')).toBeInTheDocument();
    expect(within(row).getByText('(1 free)')).toBeInTheDocument();
  });
});

describe('CartPanel discount labelling', () => {
  it('names the offer kind that cut the line', () => {
    renderCart(
      [line()],
      [
        {
          subtotal: 699,
          discount_amount: 69.9,
          after_discount: 629.1,
          discounts: [{ kind: 'product_promotion', amount: 69.9 }],
          source_index: 0,
        },
      ],
    );
    expect(screen.getByText(/Product promo/)).toBeInTheDocument();
    expect(screen.getByText(/−Rs. 69.90/)).toBeInTheDocument();
  });

  it('lists every kind when offers stack', () => {
    renderCart(
      [line()],
      [
        {
          subtotal: 699,
          discount_amount: 169.9,
          after_discount: 529.1,
          discounts: [
            { kind: 'product_promotion', amount: 69.9 },
            { kind: 'coupon', amount: 100 },
          ],
          source_index: 0,
        },
      ],
    );
    expect(screen.getByText(/Product promo/)).toBeInTheDocument();
    expect(screen.getByText(/Coupon/)).toBeInTheDocument();
  });

  it('falls back to the bare amount when the quote has no per-kind split', () => {
    renderCart([line()], [{ subtotal: 699, discount_amount: 69.9, after_discount: 629.1 }]);
    expect(screen.getByText('−Rs. 69.90')).toBeInTheDocument();
  });
});

describe('CartPanel quote alignment', () => {
  const dealLine = line({
    dealId: 900,
    dealName: 'Firestarter for 2',
    dealPrice: 2499,
    components: [],
  });

  // The backend expands one deal into one quote line per component, so the quote is
  // longer than the cart. Matching by array position reads a neighbour's money.
  it('matches a cart line to its own quote line by source_index, not position', () => {
    renderCart(
      [dealLine, line()],
      [
        { subtotal: 2499, discount_amount: 0, after_discount: 2499, source_index: 0 },
        { subtotal: 0, discount_amount: 0, after_discount: 0, source_index: 0 },
        { subtotal: 0, discount_amount: 0, after_discount: 0, source_index: 0 },
        {
          subtotal: 699,
          discount_amount: 69.9,
          after_discount: 629.1,
          discounts: [{ kind: 'product_promotion', amount: 69.9 }],
          source_index: 1,
        },
      ],
    );
    // The pizza (cart index 1) must read quote index 3 — not quote index 1, which is
    // a zero-priced deal component.
    expect(screen.getByText('Rs. 629.10')).toBeInTheDocument();
    expect(screen.getByText(/Product promo/)).toBeInTheDocument();
  });

  it("sums a deal's component lines into the one cart line they came from", () => {
    renderCart(
      [dealLine],
      [
        { subtotal: 2000, discount_amount: 100, after_discount: 1900, source_index: 0 },
        { subtotal: 499, discount_amount: 0, after_discount: 499, source_index: 0 },
      ],
    );
    expect(screen.getByText('Rs. 2499.00')).toBeInTheDocument(); // 2000 + 499 struck through
    expect(screen.getByText('Rs. 2399.00')).toBeInTheDocument(); // 1900 + 499 payable
  });
});

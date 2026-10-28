import { describe, it, expect } from 'vitest';
import { orderLineExtrasUnits, savedAddonAmount, savedModifierBilling } from './modifierPricing';

describe('saved order extras are billed per unit of the line', () => {
  it('a plain line bills its extras × its quantity; a deal component once', () => {
    expect(orderLineExtrasUnits({ quantity: 3 })).toBe(3);
    expect(orderLineExtrasUnits({ quantity: 3, deal_id: null })).toBe(3);
    expect(orderLineExtrasUnits({ quantity: 2, deal_id: 7 })).toBe(1);
    expect(orderLineExtrasUnits({})).toBe(1);
  });

  it('gives the free allowance on every unit', () => {
    // 3 toppings picked per pizza, 1 included, on 2 pizzas: 4 charged.
    expect(savedModifierBilling({ unit_price: 120, quantity: 3, free_quantity: 1 }, 2)).toEqual({
      qty: 6,
      free: 2,
      unit: 120,
      amount: 480,
    });
    // Older payloads without the counts read as one unit.
    expect(savedModifierBilling({ unit_price: 250 }, 3).amount).toBe(750);
  });

  it('multiplies an add-on by the line, its saved subtotal first', () => {
    expect(savedAddonAmount({ unit_price: 60, quantity: 2, subtotal: 120 }, 3)).toBe(360);
    expect(savedAddonAmount({ unit_price: 60, quantity: 2 }, 3)).toBe(360);
    expect(savedAddonAmount({ unit_price: 60, quantity: 1 })).toBe(60);
  });
});

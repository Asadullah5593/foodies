import { describe, it, expect } from 'vitest';
import { PrintedVoucher, PrintedVoucherFormOptions } from '../../types';
import {
  choiceIdsFor,
  emptyVoucherForm,
  formFromVoucher,
  includedOptionChoices,
  modifierIdsFor,
  payloadFromForm,
  qualifyingGroupIds,
  voucherFormError,
} from './printedVoucherForm';

/**
 * Peperi Co as it is on the real menu: every burger has its own copy of the
 * "Make it a Meal?" group, with the same two options.
 */
const options: PrintedVoucherFormOptions = {
  categories: [
    { id: 600, name: 'Beef Smashed Special', is_active: true },
    { id: 601, name: 'Peri Peri Chicken', is_active: true },
  ],
  products: [
    { id: 300, name: 'Smashed Classic', base_price: 999, is_active: true, category_id: 600, category_name: 'Beef Smashed Special', modifier_group_ids: [10, 11] },
    { id: 301, name: 'California Smash', base_price: 1299, is_active: true, category_id: 600, category_name: 'Beef Smashed Special', modifier_group_ids: [20] },
    { id: 310, name: '1/4 Peri Peri Chicken', base_price: 699, is_active: true, category_id: 601, category_name: 'Peri Peri Chicken', modifier_group_ids: [30] },
  ],
  modifier_options: [
    { id: 9001, name: 'Add Fries & Drink', price: 350, group_id: 10, group_name: 'Make it a Meal?' },
    { id: 9050, name: 'Pepsi 500ml', price: 50, group_id: 11, group_name: 'Choose your Meal Drink' },
    { id: 9101, name: 'Add Fries & Drink', price: 350, group_id: 20, group_name: 'Make it a Meal?' },
    { id: 9201, name: 'Add Fries & Drink', price: 350, group_id: 30, group_name: 'Make it a Meal?' },
  ],
  branches: [{ id: 10, name: 'Pine Avenue', is_active: true }],
};

describe('"price also includes" choices', () => {
  it('offers only the options of the items the voucher applies to', () => {
    const groups = qualifyingGroupIds(options, [], [300]);
    expect(groups.sort()).toEqual([10, 11]);
    expect(includedOptionChoices(options, groups).map((c) => c.name)).toEqual([
      'Choose your Meal Drink → Pepsi 500ml (+Rs 50)',
      'Make it a Meal? → Add Fries & Drink (+Rs 350)',
    ]);
  });

  it('merges identical copies of an option into one choice carrying every id', () => {
    // Both burgers in the category: two copies of the meal option, one line.
    const choices = includedOptionChoices(options, qualifyingGroupIds(options, [600], []));
    const meal = choices.find((c) => c.name.startsWith('Make it a Meal?'))!;
    expect(choices.filter((c) => c.name.startsWith('Make it a Meal?'))).toHaveLength(1);
    expect(meal.ids.sort()).toEqual([9001, 9101]);
    expect(meal.id).toBe(9001);
    // Saving the choice saves every copy, so whichever burger is ordered qualifies.
    expect(modifierIdsFor(choices, [meal.id]).sort()).toEqual([9001, 9101]);
  });

  it('finds the choice again from the ids a voucher was saved with', () => {
    const choices = includedOptionChoices(options, qualifyingGroupIds(options, [600], []));
    expect(choiceIdsFor(choices, [9101])).toEqual([9001]);
    expect(choiceIdsFor(choices, [])).toEqual([]);
  });

  it('has nothing to offer before a brand is loaded or an item is picked', () => {
    expect(qualifyingGroupIds(undefined, [600], [])).toEqual([]);
    expect(includedOptionChoices(options, [])).toEqual([]);
  });
});

describe('voucher form', () => {
  const pizza = { ...emptyVoucherForm(25), name: 'Any Large Pizza', value: 999 as const, category_ids: [501, 502] };

  it('accepts a complete fixed-price voucher', () => {
    expect(voucherFormError(pizza)).toBeNull();
  });

  it.each([
    [{ name: '  ' }, /name/],
    [{ brand_id: '' as const }, /brand/],
    [{ value: '' as const }, /greater than zero/],
    [{ category_ids: [], product_ids: [] }, /categories or products/],
    [{ order_types: [] }, /at least one order type/],
    [{ valid_from: '2026-12-01', valid_until: '2026-11-30' }, /cannot be before/],
  ])('stops %j', (patch, message) => {
    expect(voucherFormError({ ...pizza, ...patch })).toMatch(message);
  });

  it('lets a percentage voucher cover the whole menu, up to 100%', () => {
    const pct = { ...emptyVoucherForm(25), name: '30% off', voucher_type: 'percentage' as const, value: 30 as const };
    expect(voucherFormError(pct)).toBeNull();
    expect(voucherFormError({ ...pct, value: 130 })).toMatch(/cannot exceed 100%/);
  });

  it('sends "all three order types" as no restriction, and dates as days', () => {
    const payload = payloadFromForm({ ...pizza, valid_until: '2026-11-30' }, []);
    expect(payload).toMatchObject({
      name: 'Any Large Pizza',
      brand_id: 25,
      voucher_type: 'fixed_price',
      value: 999,
      category_ids: [501, 502],
      order_types: null,
      valid_from: null,
      valid_until: '2026-11-30',
      max_discount_amount: null,
      included_modifier_ids: [],
      sort_order: 0,
      is_active: true,
    });
    expect(payloadFromForm({ ...pizza, order_types: ['pickup', 'dine_in'] }, []).order_types).toEqual([
      'pickup',
      'dine_in',
    ]);
  });

  it('keeps each type-only field off the other type', () => {
    const choices = includedOptionChoices(options, [10]);
    const meal = { ...emptyVoucherForm(23), name: 'Meal', value: 799 as const, product_ids: [300], included_choice_ids: [9001], max_discount_amount: 500 as const };
    expect(payloadFromForm(meal, choices)).toMatchObject({ included_modifier_ids: [9001], max_discount_amount: null });
    expect(payloadFromForm({ ...meal, voucher_type: 'percentage' }, choices)).toMatchObject({
      included_modifier_ids: [],
      max_discount_amount: 500,
    });
  });

  it('loads a saved voucher back into the form', () => {
    const saved: PrintedVoucher = {
      id: 5, name: 'Any Large Pizza', brand_id: 25, brand_name: 'Fireaway', voucher_type: 'fixed_price', value: 999,
      max_discount_amount: null, category_ids: [501, 502], category_names: ['Classic', 'Signature'], product_ids: [],
      product_names: [], included_modifier_ids: [], included_modifier_names: [], eligibility_branch_ids: [10],
      branch_names: ['Pine Avenue'], order_types: ['pickup', 'dine_in'], valid_from: null, valid_until: '2026-11-30',
      sort_order: 2, is_active: true,
    };
    expect(formFromVoucher(saved)).toMatchObject({
      name: 'Any Large Pizza',
      brand_id: 25,
      value: 999,
      category_ids: [501, 502],
      eligibility_branch_ids: [10],
      order_types: ['pickup', 'dine_in'],
      valid_from: '',
      valid_until: '2026-11-30',
      sort_order: 2,
    });
    // null from the API = every order type = all three ticked in the form.
    expect(formFromVoucher({ ...saved, order_types: null }).order_types).toEqual(['delivery', 'pickup', 'dine_in']);
  });
});

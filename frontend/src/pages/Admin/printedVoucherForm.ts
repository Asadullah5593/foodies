import {
  PrintedVoucher,
  PrintedVoucherFormOptions,
  PrintedVoucherPayload,
  PrintedVoucherType,
} from '../../types';
import { ALL_OFFER_ORDER_TYPES, orderTypesToApi, orderTypesToForm } from '../../components/OfferOrderTypesField';

/** The voucher form's state — strings/blank where an input can be empty. */
export interface VoucherForm {
  name: string;
  brand_id: number | '';
  voucher_type: PrintedVoucherType;
  value: number | '';
  max_discount_amount: number | '';
  category_ids: number[];
  product_ids: number[];
  /** Ids of the picked "price includes" choices — see includedOptionChoices. */
  included_choice_ids: number[];
  eligibility_branch_ids: number[];
  order_types: string[];
  valid_from: string;
  valid_until: string;
  sort_order: number | '';
  is_active: boolean;
}

export const emptyVoucherForm = (brandId: number | '' = ''): VoucherForm => ({
  name: '',
  brand_id: brandId,
  voucher_type: 'fixed_price',
  value: '',
  max_discount_amount: '',
  category_ids: [],
  product_ids: [],
  included_choice_ids: [],
  eligibility_branch_ids: [],
  order_types: [...ALL_OFFER_ORDER_TYPES],
  valid_from: '',
  valid_until: '',
  sort_order: '',
  is_active: true,
});

/**
 * One line in the "Price also includes" picker.
 *
 * The same option ("Make it a Meal? → Add Fries & Drink") often exists once per
 * item, as separate groups with identical names. Showing each copy would be a
 * list of indistinguishable rows, so copies with the same group name, option
 * name and price are ONE choice that carries every underlying id. `id` is the
 * smallest of them — a stable handle for the multi-select.
 */
export interface IncludedOptionChoice {
  id: number;
  name: string;
  ids: number[];
}

/** Option groups offered by the items the voucher applies to. */
export function qualifyingGroupIds(
  options: PrintedVoucherFormOptions | undefined,
  categoryIds: number[],
  productIds: number[],
): number[] {
  if (!options) return [];
  const groups = new Set<number>();
  for (const p of options.products) {
    const picked = productIds.includes(p.id) || (p.category_id != null && categoryIds.includes(p.category_id));
    if (picked) for (const g of p.modifier_group_ids) groups.add(g);
  }
  return [...groups];
}

/** The paid options of those groups, with identical copies merged into one choice. */
export function includedOptionChoices(
  options: PrintedVoucherFormOptions | undefined,
  groupIds: number[],
): IncludedOptionChoice[] {
  if (!options || groupIds.length === 0) return [];
  const byKey = new Map<string, IncludedOptionChoice>();
  for (const o of options.modifier_options) {
    if (!groupIds.includes(o.group_id)) continue;
    const name = `${o.group_name} → ${o.name} (+Rs ${Number(o.price).toLocaleString('en-US')})`;
    const existing = byKey.get(name);
    if (existing) {
      existing.ids.push(o.id);
      existing.id = Math.min(existing.id, o.id);
    } else {
      byKey.set(name, { id: o.id, name, ids: [o.id] });
    }
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Which choices a saved voucher's included option ids correspond to. */
export function choiceIdsFor(choices: IncludedOptionChoice[], includedModifierIds: number[]): number[] {
  return choices.filter((c) => c.ids.some((id) => includedModifierIds.includes(id))).map((c) => c.id);
}

/** Every underlying option id behind the picked choices. */
export function modifierIdsFor(choices: IncludedOptionChoice[], choiceIds: number[]): number[] {
  return choices.filter((c) => choiceIds.includes(c.id)).flatMap((c) => c.ids);
}

export function formFromVoucher(v: PrintedVoucher): VoucherForm {
  return {
    name: v.name,
    brand_id: v.brand_id,
    voucher_type: v.voucher_type,
    value: v.value,
    max_discount_amount: v.max_discount_amount ?? '',
    category_ids: v.category_ids ?? [],
    product_ids: v.product_ids ?? [],
    // Resolved against the brand's options once they load — see the page.
    included_choice_ids: [],
    eligibility_branch_ids: v.eligibility_branch_ids ?? [],
    order_types: orderTypesToForm(v.order_types),
    valid_from: v.valid_from ?? '',
    valid_until: v.valid_until ?? '',
    sort_order: v.sort_order ?? '',
    is_active: v.is_active,
  };
}

/** What stops the form being saved, in the user's words; null when it can be. */
export function voucherFormError(form: VoucherForm): string | null {
  if (!form.name.trim()) return 'Give the voucher a name';
  if (form.brand_id === '') return 'Choose the brand this voucher is for';
  if (form.value === '' || Number(form.value) <= 0) return 'Value must be greater than zero';
  if (form.voucher_type === 'percentage' && Number(form.value) > 100)
    return 'A percentage voucher cannot exceed 100%';
  if (form.voucher_type === 'fixed_price' && form.category_ids.length === 0 && form.product_ids.length === 0)
    return 'Choose the categories or products this voucher price applies to';
  if (form.order_types.length === 0) return 'Tick at least one order type';
  if (form.valid_from && form.valid_until && form.valid_from > form.valid_until)
    return '"Valid until" cannot be before "Valid from"';
  return null;
}

export function payloadFromForm(form: VoucherForm, choices: IncludedOptionChoice[]): PrintedVoucherPayload {
  const fixed = form.voucher_type === 'fixed_price';
  return {
    name: form.name.trim(),
    brand_id: form.brand_id === '' ? null : Number(form.brand_id),
    voucher_type: form.voucher_type,
    value: form.value === '' ? null : Number(form.value),
    // Each of these means something on one type only; the server rejects the other.
    max_discount_amount: fixed || form.max_discount_amount === '' ? null : Number(form.max_discount_amount),
    included_modifier_ids: fixed ? modifierIdsFor(choices, form.included_choice_ids) : [],
    category_ids: form.category_ids,
    product_ids: form.product_ids,
    eligibility_branch_ids: form.eligibility_branch_ids,
    order_types: orderTypesToApi(form.order_types),
    valid_from: form.valid_from || null,
    valid_until: form.valid_until || null,
    sort_order: form.sort_order === '' ? 0 : Number(form.sort_order),
    is_active: form.is_active,
  };
}

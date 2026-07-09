import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Button from '../../../components/Button';
import { formatCurrency } from '../../../utils/currency';
import { CartLine } from './types';
import { computeModifiersPrice, resolveModifierUnitPrice, resolveIncludedQuantity, resolveTierCharge, sizeKeyForSelection } from '../../../utils/modifierPricing';

export type QuoteLineBreakdown = {
  subtotal?: number;
  discount_amount?: number;
  after_discount?: number;
};

export type CartPanelProps = {
  items: CartLine[];
  onUpdateQuantity: (index: number, quantity: number) => void;
  onRemoveItem: (index: number) => void;
  /** If provided, remove button triggers this instead of onRemoveItem (e.g. to show confirmation modal) */
  onRequestRemoveItem?: (index: number) => void;
  /** Open configuration for an existing cart line (edit). */
  onConfigureItem?: (index: number) => void;
  getBrandName: (brandId: number | null | undefined) => string | null;
  lineBreakdown?: QuoteLineBreakdown[] | null;
};

const CartPanel: React.FC<CartPanelProps> = ({
  items,
  onUpdateQuantity,
  onRemoveItem,
  onRequestRemoveItem,
  onConfigureItem,
  getBrandName,
  lineBreakdown,
}) => {
  const handleRemove = (index: number) => {
    if (onRequestRemoveItem) onRequestRemoveItem(index);
    else onRemoveItem(index);
  };
  return (
    <div className="min-h-[120px]">
      <h3 className="text-sm font-semibold text-foodies-textPrimary mb-2">Items ({items.length})</h3>
      {items.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-foodies-border dark:border-slate-600 bg-foodies-surfaceMuted/50 dark:bg-slate-800/50 py-10 text-center">
          <p className="text-foodies-textSecondary dark:text-slate-400">No items added yet</p>
          <p className="text-xs text-foodies-textSecondary dark:text-slate-500 mt-1">Tap menu items on the left to add</p>
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence>
            {items.map((item, index) => {
              const isDeal = item.dealId != null && item.dealPrice != null;
              const itemTotal = isDeal
                ? (() => {
                    const componentExtras = (item.components ?? []).reduce((s, c) => {
                      const addonsPrice = (c.addons ?? []).reduce((aSum, a) => {
                        const addonItem = c.menuItem.addons?.find(ad => ad.id === a.addonId);
                        return aSum + (addonItem?.price || 0) * a.quantity;
                      }, 0);
                      const modifiersPrice = computeModifiersPrice(
                        c.menuItem.modifier_groups,
                        c.modifiers,
                        sizeKeyForSelection(c.menuItem, c.variantId),
                      );
                      // Per-slot upgrade surcharge (e.g. +Rs100 Firey Special).
                      const surcharge = (c.surcharge ?? 0) * c.quantity;
                      return s + addonsPrice + modifiersPrice + surcharge;
                    }, 0);
                    return (item.dealPrice! + componentExtras) * item.quantity;
                  })()
                : (() => {
                    const itemPrice = item.menuItem.price || item.menuItem.base_price || 0;
                    const variantPrice = item.variantId && item.menuItem.variants
                      ? item.menuItem.variants.find(v => v.id === item.variantId)?.price_modifier || 0
                      : 0;
                    const addonsPrice = item.addons.reduce((sum, addon) => {
                      const addonItem = item.menuItem.addons?.find(a => a.id === addon.addonId);
                      return sum + (addonItem?.price || 0) * addon.quantity;
                    }, 0);
                    const modifiersPrice = computeModifiersPrice(
                      item.menuItem.modifier_groups,
                      item.modifiers,
                      sizeKeyForSelection(item.menuItem, item.variantId),
                    );
                    return (itemPrice + variantPrice + addonsPrice + modifiersPrice) * item.quantity;
                  })();
              const lineBreakdownItem = lineBreakdown?.[index];
              const originalAmount = lineBreakdownItem?.subtotal ?? itemTotal;
              const lineDiscount = lineBreakdownItem?.discount_amount ?? 0;
              const afterDiscount = lineBreakdownItem?.after_discount ?? itemTotal;

              return (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="bg-foodies-surface dark:bg-slate-800 p-4 rounded-xl border border-foodies-border dark:border-slate-600 shadow-sm"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex-1">
                      <h4 className="font-semibold text-foodies-textPrimary dark:text-slate-100">
                        {isDeal ? (item.dealName ?? item.menuItem.name) : item.menuItem.name}
                      </h4>
                      {isDeal && item.components?.length ? (
                        // A deal is a fixed-price bundle — show the chosen components (names/sizes
                        // only), never per-component prices, so the deal total isn't second-guessed.
                        <ul className="mt-1 text-xs text-foodies-textSecondary space-y-0.5">
                          {item.components.map((c, i) => {
                            const variant = c.variantId && c.menuItem.variants?.length ? c.menuItem.variants.find(v => v.id === c.variantId) : null;
                            return (
                              <li key={i} className="pl-1 border-l-2 border-foodies-border dark:border-slate-600">
                                {c.quantity}x {c.menuItem.name}
                                {variant ? <span className="text-foodies-textSecondary"> — {variant.name}</span> : null}
                                {(c.addons ?? []).length > 0 ? (
                                  <ul className="mt-0.5 ml-2 space-y-0.5">
                                    {(c.addons ?? []).map((a) => {
                                      const addon = c.menuItem.addons?.find(ad => ad.id === a.addonId);
                                      return addon ? <li key={a.addonId}>+ {addon.name} ×{a.quantity}</li> : null;
                                    })}
                                  </ul>
                                ) : null}
                                {(c.modifiers ?? []).length > 0 ? (
                                  <ul className="mt-0.5 ml-2 space-y-0.5">
                                    {(c.modifiers ?? []).map((m) => {
                                      const mod = c.menuItem.modifier_groups?.flatMap(g => g.modifiers).find(mo => mo.id === m.modifierId);
                                      return mod ? <li key={m.modifierId}>+ {mod.name}{m.quantity > 1 ? ` ×${m.quantity}` : ''}</li> : null;
                                    })}
                                  </ul>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                      {!isDeal && getBrandName(item.menuItem.brand_id) && (
                        <p className="text-xs text-foodies-primary font-medium">{getBrandName(item.menuItem.brand_id)}</p>
                      )}
                      {!isDeal && item.variantId && (() => {
                        const v = item.menuItem.variants?.find(vr => vr.id === item.variantId);
                        const basePrice = item.menuItem.price || item.menuItem.base_price || 0;
                        const totalVariantPrice = basePrice + Number(v?.price_modifier ?? 0);
                        return v ? (
                          <p className="text-xs text-foodies-textSecondary">
                            {v.name} <span className="text-foodies-cta font-medium">{formatCurrency(totalVariantPrice)}</span>
                          </p>
                        ) : null;
                      })()}
                      {!isDeal && item.addons.length > 0 && (
                        <ul className="text-xs text-foodies-textSecondary mt-0.5 space-y-0.5">
                          {item.addons.map(a => {
                            const addon = item.menuItem.addons?.find(ad => ad.id === a.addonId);
                            const p = addon ? Number(addon.price ?? 0) * a.quantity : 0;
                            return addon ? <li key={a.addonId}>Add-on: {addon.name} ×{a.quantity} {formatCurrency(p)}</li> : null;
                          })}
                        </ul>
                      )}
                      {!isDeal && (item.modifiers ?? []).length > 0 && (() => {
                        const groups = item.menuItem.modifier_groups ?? [];
                        const sizeKey = sizeKeyForSelection(item.menuItem, item.variantId);
                        const groupOf = new Map(groups.flatMap(g => (g.modifiers ?? []).map(m => [m.id, g])));
                        const lines: React.ReactNode[] = [];
                        const renderedGroups = new Set<number>();
                        for (const sel of item.modifiers ?? []) {
                          const group = groupOf.get(sel.modifierId);
                          const mod = group ? (group.modifiers ?? []).find(m => m.id === sel.modifierId) : undefined;
                          if (!mod) continue;
                          const hasTiers = group?.price_tiers && Object.keys(group.price_tiers).length > 0;
                          if (hasTiers && group && !renderedGroups.has(group.id)) {
                            renderedGroups.add(group.id);
                            const groupSels = (item.modifiers ?? []).filter(s => groupOf.get(s.modifierId)?.id === group.id);
                            const names = groupSels.map(s => {
                              const m = (group.modifiers ?? []).find(x => x.id === s.modifierId);
                              return m ? `${m.name}${s.quantity > 1 ? ` ×${s.quantity}` : ''}` : '';
                            }).filter(Boolean).join(', ');
                            const totalQty = groupSels.reduce((s, x) => s + (x.quantity ?? 1), 0);
                            const free = resolveIncludedQuantity(group, sizeKey);
                            const charged = Math.max(0, totalQty - free);
                            const cost = resolveTierCharge(group.price_tiers!, charged);
                            lines.push(<li key={`tier-${group.id}`}>{names} {formatCurrency(cost)}</li>);
                          } else if (!hasTiers) {
                            // Slot-based free allocation: compute free units for this modifier
                            const groupSels = (item.modifiers ?? []).filter(s => groupOf.get(s.modifierId)?.id === group?.id);
                            const free = group ? resolveIncludedQuantity(group, sizeKey) : 0;
                            // Build slot list for the group, sort by (slot, price), take first `free`
                            type SlotUnit = { modifierId: number; price: number; slot: number };
                            const slotUnits: SlotUnit[] = [];
                            for (const s of groupSels) {
                              const m2 = (group?.modifiers ?? []).find(x => x.id === s.modifierId);
                              const up = m2 ? resolveModifierUnitPrice(m2, sizeKey) : 0;
                              for (let i = 0; i < (s.quantity ?? 1); i++) slotUnits.push({ modifierId: s.modifierId, price: up, slot: i });
                            }
                            slotUnits.sort((a, b) => a.slot !== b.slot ? a.slot - b.slot : a.price - b.price);
                            const freeByMod = new Map<number, number>();
                            let freeLeft = free;
                            for (const u of slotUnits) {
                              if (freeLeft <= 0) break;
                              freeByMod.set(u.modifierId, (freeByMod.get(u.modifierId) ?? 0) + 1);
                              freeLeft--;
                            }
                            const qty = sel.quantity ?? 1;
                            const freeUnits = freeByMod.get(sel.modifierId) ?? 0;
                            const chargedUnits = Math.max(0, qty - freeUnits);
                            const unitPrice = resolveModifierUnitPrice(mod, sizeKey);
                            const p = unitPrice * chargedUnits;
                            // Zero-price modifiers (e.g. crust/base choices) never show a price tag.
                            const priceNode = unitPrice <= 0 ? null
                              : freeUnits > 0 && chargedUnits === 0 ? <span className="text-emerald-600">Included</span>
                              : freeUnits > 0 ? <>{formatCurrency(p)} <span className="text-emerald-600">({freeUnits} free)</span></>
                              : formatCurrency(p);
                            // Conditional chooser pick (e.g. meal drink) → nest under its trigger
                            // option so "+130 meal" and "+250 shake" read as one upgrade chain.
                            const vw = group?.visible_when_modifier_ids;
                            const triggerSel = vw?.length
                              ? (item.modifiers ?? []).find(s2 => vw.includes(s2.modifierId))
                              : undefined;
                            if (triggerSel) {
                              lines.push(
                                <li key={sel.modifierId} className="pl-3">
                                  ↳ {mod.name}{qty > 1 ? ` ×${qty}` : ''}{' '}
                                  {unitPrice <= 0 ? <span className="text-emerald-600">Included</span> : priceNode}
                                </li>
                              );
                            } else {
                              lines.push(<li key={sel.modifierId}>{mod.name}{qty > 1 ? ` ×${qty}` : ''}{priceNode ? <> {priceNode}</> : null}</li>);
                            }
                          }
                        }
                        return <ul className="text-xs text-foodies-textSecondary mt-0.5 space-y-0.5">{lines}</ul>;
                      })()}
                      {!isDeal && item.notes && (
                        <p className="text-xs text-foodies-textSecondary italic">Note: {item.notes}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {onConfigureItem && (
                        <Button
                          size="small"
                          variant="outline"
                          onClick={() => onConfigureItem(index)}
                        >
                          Edit
                        </Button>
                      )}
                      <Button
                        size="small"
                        variant="danger"
                        onClick={() => handleRemove(index)}
                        className="min-w-[2rem]"
                      >
                        ×
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-foodies-textSecondary">Qty</span>
                      <div className="flex items-center rounded-lg border border-foodies-border dark:border-slate-600 overflow-hidden">
                        <button
                          type="button"
                          aria-label="Decrease quantity"
                          disabled={item.quantity <= 1}
                          onClick={() => onUpdateQuantity(index, Math.max(1, item.quantity - 1))}
                          className="px-3 py-1.5 text-lg leading-none text-foodies-textPrimary dark:text-slate-100 hover:bg-foodies-surfaceMuted dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          −
                        </button>
                        <span className="min-w-[2.5rem] text-center text-sm font-semibold tabular-nums select-none text-foodies-textPrimary dark:text-slate-100">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          aria-label="Increase quantity"
                          onClick={() => onUpdateQuantity(index, item.quantity + 1)}
                          className="px-3 py-1.5 text-lg leading-none text-foodies-textPrimary dark:text-slate-100 hover:bg-foodies-surfaceMuted dark:hover:bg-slate-700"
                        >
                          +
                        </button>
                      </div>
                    </div>
                    <div className="text-right">
                      {lineDiscount > 0 ? (
                        <>
                          <div className="text-sm text-foodies-textSecondary line-through">{formatCurrency(originalAmount)}</div>
                          <div className="text-xs text-foodies-cta">−{formatCurrency(lineDiscount)}</div>
                          <div className="text-lg font-bold text-foodies-cta">{formatCurrency(afterDiscount)}</div>
                        </>
                      ) : (
                        <span className="text-lg font-bold text-foodies-cta">{formatCurrency(itemTotal)}</span>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
};

export default CartPanel;

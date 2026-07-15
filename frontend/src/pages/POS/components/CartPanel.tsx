import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Button from '../../../components/Button';
import { formatCurrency } from '../../../utils/currency';
import { CartLine } from './types';
import { computeModifiersPrice, resolveModifierUnitPrice, resolveIncludedQuantity, resolveTierCharge, sizeKeyForSelection } from '../../../utils/modifierPricing';
import { OfferKind, offerKindLabel } from '../../../utils/offerKinds';

export type QuoteLineBreakdown = {
  subtotal?: number;
  discount_amount?: number;
  after_discount?: number;
  /** Per-kind split of discount_amount; kinds stack, so there may be several. */
  discounts?: Array<{ kind: OfferKind; amount: number }>;
  /** Cart index this quote line came from — a deal expands to one line per component. */
  source_index?: number;
};

/**
 * One choice row: label left, price hard right. Every row in a cart line uses this
 * so the prices form a single column no matter how the label wraps.
 */
function optionRow(
  key: React.Key,
  label: React.ReactNode,
  price: React.ReactNode,
  className = '',
): React.ReactNode {
  return (
    <li key={key} className={`flex justify-between items-baseline gap-2 ${className}`}>
      <span className="min-w-0 break-words">{label}</span>
      <span className="shrink-0 whitespace-nowrap">{price}</span>
    </li>
  );
}

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

  /**
   * Quote lines folded back onto cart lines by source_index. The backend expands a
   * deal into one line per component, so line_breakdown is LONGER than the cart and
   * indexing it by cart position reads a neighbour's money once any deal is present.
   * Falls back to positional lookup for a quote from a backend that predates
   * source_index (then a deal still misaligns, exactly as before — no worse).
   */
  const breakdownFor = React.useMemo(() => {
    const byCartIndex = new Map<number, QuoteLineBreakdown>();
    (lineBreakdown ?? []).forEach((line, i) => {
      const key = line.source_index ?? i;
      const prev = byCartIndex.get(key);
      if (!prev) {
        byCartIndex.set(key, { ...line });
        return;
      }
      // Several quote lines map to one cart line (a deal's components): sum them
      // so the cart shows the deal's whole money, not just its first component's.
      const discounts = [...(prev.discounts ?? [])];
      for (const d of line.discounts ?? []) {
        const hit = discounts.find((x) => x.kind === d.kind);
        if (hit) hit.amount = Math.round((hit.amount + d.amount) * 100) / 100;
        else discounts.push({ ...d });
      }
      byCartIndex.set(key, {
        subtotal: Math.round(((prev.subtotal ?? 0) + (line.subtotal ?? 0)) * 100) / 100,
        discount_amount:
          Math.round(((prev.discount_amount ?? 0) + (line.discount_amount ?? 0)) * 100) / 100,
        after_discount:
          Math.round(((prev.after_discount ?? 0) + (line.after_discount ?? 0)) * 100) / 100,
        discounts,
        source_index: key,
      });
    });
    return byCartIndex;
  }, [lineBreakdown]);
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
              const lineBreakdownItem = breakdownFor.get(index);
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
                          <p className="text-xs text-foodies-textSecondary flex justify-between items-baseline gap-2">
                            <span className="min-w-0 break-words">{v.name}</span>
                            <span className="shrink-0 whitespace-nowrap text-foodies-cta font-medium">
                              {formatCurrency(totalVariantPrice)}
                            </span>
                          </p>
                        ) : null;
                      })()}
                      {!isDeal && item.addons.length > 0 && (
                        <ul className="text-xs text-foodies-textSecondary mt-0.5 space-y-0.5">
                          {item.addons.map(a => {
                            const addon = item.menuItem.addons?.find(ad => ad.id === a.addonId);
                            const p = addon ? Number(addon.price ?? 0) * a.quantity : 0;
                            return addon
                              ? optionRow(a.addonId, `Add-on: ${addon.name} ×${a.quantity}`, formatCurrency(p))
                              : null;
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
                            // Tier groups are priced as a GROUP, so they stay collapsed to a
                            // single row — the per-pick split would not be meaningful.
                            lines.push(
                              optionRow(`tier-${group.id}`, `${group.name}: ${names}`, formatCurrency(cost)),
                            );
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
                            // Every choice carries a price, free ones included — a free pick
                            // reads Rs. 0.00, matching the printed receipt. The "(N free)"
                            // badge only makes sense when some units were actually charged.
                            const priceNode =
                              unitPrice > 0 && freeUnits > 0 && chargedUnits > 0 ? (
                                <>{formatCurrency(p)} <span className="text-emerald-600">({freeUnits} free)</span></>
                              ) : (
                                formatCurrency(p)
                              );
                            // Conditional chooser pick (e.g. meal drink) → nest under its trigger
                            // option so "+130 meal" and "+250 shake" read as one upgrade chain.
                            const vw = group?.visible_when_modifier_ids;
                            const triggerSel = vw?.length
                              ? (item.modifiers ?? []).find(s2 => vw.includes(s2.modifierId))
                              : undefined;
                            // Nested picks are already under their trigger, so they carry no
                            // group prefix — same as the receipt.
                            lines.push(
                              optionRow(
                                sel.modifierId,
                                triggerSel
                                  ? `↳ ${mod.name}${qty > 1 ? ` ×${qty}` : ''}`
                                  : `${group?.name ? `${group.name}: ` : ''}${mod.name}${qty > 1 ? ` ×${qty}` : ''}`,
                                priceNode,
                                triggerSel ? 'pl-3' : '',
                              ),
                            );
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
                          {/* Name each kind that cut this line. They stack, so there can be
                              several; fall back to the bare total if the quote predates the
                              per-kind split. */}
                          {(lineBreakdownItem?.discounts ?? []).length > 0 ? (
                            (lineBreakdownItem?.discounts ?? []).map((d) => (
                              <div key={d.kind} className="text-xs text-foodies-cta">
                                {offerKindLabel(d.kind)} −{formatCurrency(d.amount)}
                              </div>
                            ))
                          ) : (
                            <div className="text-xs text-foodies-cta">−{formatCurrency(lineDiscount)}</div>
                          )}
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

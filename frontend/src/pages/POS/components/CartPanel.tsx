import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Button from '../../../components/Button';
import { formatCurrency } from '../../../utils/currency';
import { CartLine } from './types';

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
                      const modifiersPrice = (c.modifiers ?? []).reduce((mSum, m) => {
                        const mod = c.menuItem.modifier_groups?.flatMap(g => g.modifiers).find(mo => mo.id === m.modifierId);
                        return mSum + (mod?.price || 0) * m.quantity;
                      }, 0);
                      return s + addonsPrice + modifiersPrice;
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
                    const modifiersPrice = (item.modifiers ?? []).reduce((sum, mod) => {
                      const modObj = item.menuItem.modifier_groups?.flatMap(g => g.modifiers).find(m => m.id === mod.modifierId);
                      return sum + (modObj?.price || 0) * mod.quantity;
                    }, 0);
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
                        <ul className="mt-1 text-xs text-foodies-textSecondary space-y-0.5">
                          {item.components.map((c, i) => {
                            const variant = c.variantId && c.menuItem.variants?.length ? c.menuItem.variants.find(v => v.id === c.variantId) : null;
                            const variantPrice = variant ? Number(variant.price_modifier ?? 0) : 0;
                            return (
                              <li key={i} className="pl-1 border-l-2 border-foodies-border dark:border-slate-600">
                                {c.quantity}x {c.menuItem.name}
                                {variant ? <span className="text-foodies-textSecondary"> — {variant.name} ({formatCurrency(variantPrice)})</span> : null}
                                {(c.addons ?? []).length > 0 ? (
                                  <ul className="mt-0.5 ml-2 space-y-0.5">
                                    {(c.addons ?? []).map((a) => {
                                      const addon = c.menuItem.addons?.find(ad => ad.id === a.addonId);
                                      const p = addon ? Number(addon.price ?? 0) * a.quantity : 0;
                                      return addon ? <li key={a.addonId}>+ {addon.name} ×{a.quantity} {formatCurrency(p)}</li> : null;
                                    })}
                                  </ul>
                                ) : null}
                                {(c.modifiers ?? []).length > 0 ? (
                                  <ul className="mt-0.5 ml-2 space-y-0.5">
                                    {(c.modifiers ?? []).map((m) => {
                                      const mod = c.menuItem.modifier_groups?.flatMap(g => g.modifiers).find(mo => mo.id === m.modifierId);
                                      const p = mod ? Number(mod.price ?? 0) * m.quantity : 0;
                                      return mod ? <li key={m.modifierId}>+ {mod.name}{m.quantity > 1 ? ` ×${m.quantity}` : ''} {formatCurrency(p)}</li> : null;
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
                        const price = v ? Number(v.price_modifier ?? 0) : 0;
                        return (
                          <p className="text-xs text-foodies-textSecondary">
                            Variant: {v?.name} {price !== 0 && <span className="text-foodies-cta font-medium">({formatCurrency(price)})</span>}
                          </p>
                        );
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
                      {!isDeal && (item.modifiers ?? []).length > 0 && (
                        <ul className="text-xs text-foodies-textSecondary mt-0.5 space-y-0.5">
                          {(item.modifiers ?? []).map(m => {
                            const mod = item.menuItem.modifier_groups?.flatMap(g => g.modifiers).find(mo => mo.id === m.modifierId);
                            const p = mod ? Number(mod.price ?? 0) * m.quantity : 0;
                            return mod ? <li key={m.modifierId}>Modifier: {mod.name}{m.quantity > 1 ? ` ×${m.quantity}` : ''} {formatCurrency(p)}</li> : null;
                          })}
                        </ul>
                      )}
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
                      <label className="text-sm text-foodies-textSecondary">Qty:</label>
                      <input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) => onUpdateQuantity(index, parseInt(e.target.value) || 1)}
                        className="w-16 px-2 py-1 border border-foodies-border rounded text-center"
                      />
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

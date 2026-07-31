import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MdCheck, MdCheckCircle, MdAdd, MdRemove, MdClose, MdLock } from 'react-icons/md';
import { formatCurrency } from '../../../utils/currency';
import { MenuItem } from '../../../types';
import type { DealDefinition, DealSlot } from '../../../services/api/menuService';
import type { DealComponentLine } from './types';
import { defaultVariantIdForItem, type ItemConfig } from './types';
import ItemConfigModal from './ItemConfigModal';
import { bogoDealTotal } from '../../../utils/bogoPricing';
import { computeModifiersPrice, resolveMinSelect, resolveMaxSelect } from '../../../utils/modifierPricing';

export type DealConfigModalProps = {
  isOpen: boolean;
  onClose: () => void;
  deal: DealDefinition | null;
  /** When set, pre-fill slot selections (used for editing an existing cart line). */
  initialComponents?: DealComponentLine[] | null;
  onConfirm: (params: {
    dealId: number;
    dealName: string;
    dealPrice: number;
    components: DealComponentLine[];
  }) => void;
};

/** One independent selection within a slot. A multi-quantity choice slot has one pick per unit. */
type SlotPick = {
  selectedItem: MenuItem | null;
  config: ItemConfig;
};

type SlotState = {
  picks: SlotPick[];
};

/** Deal choice_items come back with `category` as a plain name string (not the {name} object the
 *  MenuItem type implies); read either shape so step labels never crash. */
const categoryNameOf = (item?: MenuItem | null): string | null => {
  const c = (item as { category?: unknown } | null | undefined)?.category;
  if (!c) return null;
  if (typeof c === 'string') return c || null;
  if (typeof c === 'object' && 'name' in (c as object)) {
    return (c as { name?: string }).name ?? null;
  }
  return null;
};

const DealConfigModal: React.FC<DealConfigModalProps> = ({
  isOpen,
  onClose,
  deal,
  initialComponents,
  onConfirm,
}) => {
  const [slotStates, setSlotStates] = useState<Map<number, SlotState>>(new Map());
  const [customizeTarget, setCustomizeTarget] = useState<{ slotIndex: number; pickIdx: number } | null>(null);
  const [currentStep, setCurrentStep] = useState(0);

  // A choice slot for N>1 lets the customer pick N items independently (e.g. 2 different
  // drinks). Fixed slots and single-unit choice slots stay one pick of quantity N / 1.
  const isMultiPick = (slot: DealSlot) => slot.type !== 'fixed' && (slot.quantity ?? 1) > 1;
  const pickQuantity = (slot: DealSlot) => (isMultiPick(slot) ? 1 : slot.quantity ?? 1);

  // What can still be customized inside a deal: variants and non-cross-sell groups.
  // Add-ons are always hidden in deals, so they don't count toward "has options".
  const hasOptions = (item: MenuItem | null) =>
    !!item && !!(item.variants?.length || item.modifier_groups?.some((g) => !g.hide_in_deals));

  // Per-item upgrade surcharge for a choice (e.g. "+Rs100 to upgrade to Firey Special").
  const slotSurchargeFor = (slot: DealSlot, item: MenuItem | null): number =>
    item ? Number(slot.slot_surcharges?.[String(item.id)] ?? 0) : 0;

  // Strict pairing key for "same category" (Classic↔Classic, Signature↔Signature, BYO↔BYO):
  // same catalog category AND same label.
  const pairKey = (item: MenuItem | null | undefined): string =>
    item ? `${item.category_id ?? ''}|${item.label ?? ''}` : '';

  const sizeKeyOf = (item: MenuItem | null | undefined, variantId?: number): string | null =>
    item?.variants?.find((v) => v.id === variantId)?.size_key ?? null;

  // Regular price of a pizza at the chosen size (base/effective + size modifier) — matches the
  // server's getEffectiveUnitPrice + variant.priceModifier used for BOGO pricing.
  const regularPrice = (item: MenuItem | null | undefined, variantId?: number): number => {
    if (!item) return 0;
    const base = Number(item.price ?? item.base_price ?? 0);
    const mod = Number(item.variants?.find((v) => v.id === variantId)?.price_modifier ?? 0);
    return base + mod;
  };

  // Pre-select a variant for a slot: a fixed size lock, else a forced (mirrored) size, else the
  // first ALLOWED size (so a BOGO slot lands on 12"/14" rather than the 7" default), else default.
  const variantIdForSlot = (
    item: MenuItem | null,
    slot: DealSlot,
    forcedSizeKey?: string | null,
  ): number | undefined => {
    if (!item) return undefined;
    const sizeKey = forcedSizeKey ?? slot.slot_size_key ?? null;
    if (sizeKey) {
      const v = item.variants?.find((vr) => (vr.size_key ?? null) === sizeKey);
      if (v) return v.id;
    }
    if (slot.allowed_size_keys?.length) {
      const v = item.variants?.find(
        (vr) => vr.size_key != null && slot.allowed_size_keys!.includes(vr.size_key),
      );
      if (v) return v.id;
    }
    return defaultVariantIdForItem(item);
  };

  // The pick of the slot this slot mirrors (BOGO 2nd pizza mirrors slot 0).
  const mirroredPickOf = (slot: DealSlot): SlotPick | null =>
    slot.mirror_slot_index != null
      ? slotStates.get(slot.mirror_slot_index)?.picks[0] ?? null
      : null;

  // The size this slot is forced to (its mirrored slot's chosen size), if any.
  const forcedSizeKeyForSlot = (slot: DealSlot): string | null => {
    if (slot.mirror_slot_index == null || !slot.mirror_match_size) return null;
    const m = mirroredPickOf(slot);
    return m?.selectedItem ? sizeKeyOf(m.selectedItem, m.config.variantId) : null;
  };

  // Choices a slot offers right now: a mirror slot is restricted to the SAME (category,label)
  // as its mirrored pick, and shows nothing until that pick exists.
  const effectiveChoiceItems = (slot: DealSlot): MenuItem[] => {
    const items = slot.choice_items ?? [];
    if (slot.mirror_slot_index == null) return items;
    if (!slot.mirror_match_category && !slot.mirror_match_size) return items;
    const m = mirroredPickOf(slot);
    if (!m?.selectedItem) return [];
    let result = items;
    if (slot.mirror_match_category)
      result = result.filter((it) => pairKey(it) === pairKey(m.selectedItem));
    if (slot.mirror_match_size) {
      const ms = sizeKeyOf(m.selectedItem, m.config.variantId);
      if (ms)
        // Only offer items that actually have the mirrored size variant.
        result = result.filter((it) =>
          it.variants?.some((v) => (v.size_key ?? null) === ms),
        );
    }
    return result;
  };

  // Human label for a size-locked slot (e.g. "Large 12\"" / "5 Pcs"), from the matching variant.
  const sizeChipLabel = (slot: DealSlot, choiceItems: MenuItem[]): string | null => {
    if (!slot.slot_size_key) return null;
    for (const it of choiceItems) {
      const v = it.variants?.find((vr) => (vr.size_key ?? null) === slot.slot_size_key);
      if (v?.name) return v.name;
    }
    return slot.slot_size_key;
  };

  const initPick = (slot: DealSlot, item: MenuItem | null): SlotPick => ({
    selectedItem: item,
    config: { addons: [], modifiers: [], variantId: variantIdForSlot(item, slot) },
  });

  // A user-driven pick that honours a mirror slot's forced size (mirrored slot's chosen size).
  const makePick = (slot: DealSlot, item: MenuItem): SlotPick => ({
    selectedItem: item,
    config: { addons: [], modifiers: [], variantId: variantIdForSlot(item, slot, forcedSizeKeyForSlot(slot)) },
  });

  const initSlotState = (slot: DealSlot): SlotState => {
    if (slot.type === 'fixed' && slot.choice_items?.length === 1) {
      return { picks: [initPick(slot, slot.choice_items[0] ?? null)] };
    }
    if (slot.type === 'choice_category' || slot.type === 'choice_list') {
      // Choice slots start EMPTY — nothing pre-selected, so the running total
      // starts at 0 for dynamic (BOGO) deals and the cashier must actively pick
      // each slot (a pre-selected first option kept landing in orders unnoticed
      // and made the opening price read as already-charged).
      return { picks: [] };
    }
    return { picks: [{ selectedItem: null, config: { addons: [], modifiers: [] } }] };
  };

  useEffect(() => {
    if (isOpen && deal?.slots?.length) {
      const initial = new Map<number, SlotState>();
      deal.slots.forEach((slot) => {
        const existing = (initialComponents ?? []).filter(
          (c) => (c.slot_index ?? slot.slot_index) === slot.slot_index,
        );
        if (existing.length) {
          initial.set(slot.slot_index, {
            picks: existing.map((c) => ({
              selectedItem: c.menuItem,
              config: {
                variantId: c.variantId,
                addons: c.addons ?? [],
                modifiers: c.modifiers ?? [],
                notes: c.notes,
              },
            })),
          });
        } else {
          initial.set(slot.slot_index, initSlotState(slot));
        }
      });
      setSlotStates(initial);
      setCurrentStep(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, deal?.deal_menu_item_id, initialComponents]);

  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : 'unset';
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  const getSlotState = (slotIndex: number, slot: DealSlot): SlotState => {
    return slotStates.get(slotIndex) ?? initSlotState(slot);
  };

  const slotUnitCount = (state: SlotState) => state.picks.filter((p) => p.selectedItem != null).length;

  /**
   * A picked item whose REQUIRED options (min-select groups like "Choose your Base" /
   * "Choose your Toppings", or a size the slot doesn't pin) haven't been chosen yet —
   * the pick must go through Customize before the deal can be added, otherwise the box
   * would be sent to the kitchen with no base/toppings/flavour. Mirrors the à-la-carte
   * ItemConfigModal's required-step rules (hide_in_deals groups are the deal's own slots;
   * conditional groups only count once triggered; min resolves per the locked/chosen size).
   * Multi-unit mix&match slots are exempt — they have no Customize affordance, and every
   * menu puts only customization-free items (sides/drinks) in them.
   */
  const pickNeedsOptions = (slot: DealSlot, pick: SlotPick): boolean => {
    const item = pick.selectedItem;
    if (!item || !slot.allow_customization || isMultiPick(slot)) return false;
    const config = pick.config;
    if ((item.variants?.length ?? 0) > 0 && config.variantId == null) return true;
    const sizeKey = slot.slot_size_key ?? sizeKeyOf(item, config.variantId);
    const selectedIds = new Set((config.modifiers ?? []).map((m) => m.modifierId));
    for (const g of item.modifier_groups ?? []) {
      if (g.hide_in_deals) continue;
      const triggers = g.visible_when_modifier_ids;
      if (triggers?.length && !triggers.some((id) => selectedIds.has(id))) continue;
      const min = resolveMinSelect(g, sizeKey);
      if (min <= 0) continue;
      const units = (config.modifiers ?? [])
        .filter((m) => g.modifiers.some((mod) => mod.id === m.modifierId))
        .reduce((s, m) => s + (m.quantity || 1), 0);
      if (units < min) return true;
    }
    return false;
  };

  const slotComplete = (slot: DealSlot, state: SlotState): boolean => {
    // Every picked item must have its required options chosen (see pickNeedsOptions).
    const picksConfigured = state.picks.every((p) => !pickNeedsOptions(slot, p));
    // Optional slots (e.g. "add a drink(s)") need no picks — but a picked item still
    // has to be fully configured.
    if (slot.optional) return picksConfigured;
    if (slot.type === 'fixed')
      return state.picks.length > 0 && state.picks.every((p) => p.selectedItem != null) && picksConfigured;
    if (slot.choice_items?.length) {
      if (isMultiPick(slot)) return slotUnitCount(state) >= (slot.quantity ?? 1);
      return slotUnitCount(state) >= 1 && picksConfigured;
    }
    return true;
  };

  const setPick = (slotIndex: number, pickIdx: number, patch: Partial<SlotPick>) => {
    setSlotStates((prev) => {
      const next = new Map(prev);
      const current = next.get(slotIndex) ?? { picks: [] };
      const picks = current.picks.slice();
      picks[pickIdx] = {
        ...(picks[pickIdx] ?? { selectedItem: null, config: { addons: [], modifiers: [] } }),
        ...patch,
      };
      next.set(slotIndex, { picks });
      return next;
    });
  };

  // Single-choice slot: replace the one pick with the chosen item.
  const selectSingle = (slot: DealSlot, item: MenuItem) => {
    setSlotStates((prev) => {
      const next = new Map(prev);
      next.set(slot.slot_index, { picks: [makePick(slot, item)] });
      return next;
    });
  };

  // Mix & match: add one unit (up to slot.quantity); repeats allowed.
  const addUnit = (slot: DealSlot, item: MenuItem) => {
    setSlotStates((prev) => {
      const current = prev.get(slot.slot_index) ?? { picks: [] };
      if (current.picks.length >= (slot.quantity ?? 1)) return prev;
      const next = new Map(prev);
      next.set(slot.slot_index, { picks: [...current.picks, makePick(slot, item)] });
      return next;
    });
  };

  // Mix & match: remove one unit of this item (the most recently added).
  const removeUnit = (slot: DealSlot, item: MenuItem) => {
    setSlotStates((prev) => {
      const current = prev.get(slot.slot_index) ?? { picks: [] };
      const idx = current.picks.map((p) => p.selectedItem?.id).lastIndexOf(item.id);
      if (idx === -1) return prev;
      const picks = current.picks.slice();
      picks.splice(idx, 1);
      const next = new Map(prev);
      next.set(slot.slot_index, { picks });
      return next;
    });
  };

  // Keep mirror slots (BOGO 2nd pizza) consistent with the slot they mirror: clear a pick that
  // no longer matches the mirrored category, and force its size to the mirrored size. Converges
  // in one pass (after fixing, the next run finds everything valid → no further setState).
  useEffect(() => {
    if (!isOpen || !deal?.slots?.length) return;
    for (const slot of deal.slots) {
      if (slot.mirror_slot_index == null) continue;
      const m = slotStates.get(slot.mirror_slot_index)?.picks[0] ?? null;
      const mirroredItem = m?.selectedItem ?? null;
      const mirroredSize = mirroredItem ? sizeKeyOf(mirroredItem, m?.config.variantId) : null;
      const state = slotStates.get(slot.slot_index);
      if (!state) continue;
      state.picks.forEach((pick, pickIdx) => {
        if (!pick.selectedItem) return;
        const catOk =
          !slot.mirror_match_category ||
          (mirroredItem != null && pairKey(pick.selectedItem) === pairKey(mirroredItem));
        if (!catOk) {
          setPick(slot.slot_index, pickIdx, {
            selectedItem: null,
            config: { addons: [], modifiers: [], variantId: undefined },
          });
          return;
        }
        if (slot.mirror_match_size && mirroredSize) {
          const curSize = sizeKeyOf(pick.selectedItem, pick.config.variantId);
          if (curSize !== mirroredSize) {
            // Force this pick to the mirrored size. If the item has no variant in that size,
            // clear it (rather than leave a wrong/undefined size) — guarantees the effect
            // converges instead of re-firing forever on a non-existent variant.
            const targetVariantId = pick.selectedItem.variants?.find(
              (v) => (v.size_key ?? null) === mirroredSize,
            )?.id;
            if (targetVariantId == null) {
              setPick(slot.slot_index, pickIdx, {
                selectedItem: null,
                config: { addons: [], modifiers: [], variantId: undefined },
              });
            } else {
              setPick(slot.slot_index, pickIdx, {
                config: { ...pick.config, variantId: targetVariantId },
              });
            }
          }
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotStates, deal, isOpen]);

  const slots = deal?.slots ?? [];
  const stepCount = slots.length;
  const clampedStep = Math.min(currentStep, Math.max(0, stepCount - 1));
  const currentSlot: DealSlot | undefined = slots[clampedStep];
  const isLast = stepCount > 0 && clampedStep === stepCount - 1;

  const stepLabel = (slot: DealSlot, i: number): string => {
    if (slot.type === 'fixed' && (slot.choice_items?.length ?? 0) <= 1) {
      return slot.choice_items?.[0]?.name ?? `Step ${i + 1}`;
    }
    return categoryNameOf(slot.choice_items?.[0]) ?? `Step ${i + 1}`;
  };

  const stepTitle = (slot: DealSlot): string => {
    const cat = categoryNameOf(slot.choice_items?.[0]);
    if (slot.type === 'fixed' && (slot.choice_items?.length ?? 0) <= 1) {
      return slot.choice_items?.[0]?.name ?? 'Included item';
    }
    if (slot.optional) {
      return `Add ${cat ?? 'items'} — optional, choose any`;
    }
    if (isMultiPick(slot)) {
      return `Choose ${slot.quantity} ${cat ?? 'items'} — mix & match`;
    }
    return cat ? `Choose your ${cat}` : 'Choose one';
  };

  const allSlotsComplete = useMemo(() => {
    if (!deal?.slots?.length) return false;
    return deal.slots.every((slot) => slotComplete(slot, getSlotState(slot.slot_index, slot)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal, slotStates]);

  const currentStepComplete = currentSlot
    ? slotComplete(currentSlot, getSlotState(currentSlot.slot_index, currentSlot))
    : false;
  const primaryEnabled = isLast ? allSlotsComplete : currentStepComplete;

  // Live deal price. For a 'bogo' deal it's dynamic (full + cheaper-at-percent across the chosen
  // pizzas); otherwise the fixed bundle price. Toppings/add-ons are added on top by the cart.
  const isBogo = deal?.pricing_mode === 'bogo';
  const dealTotal = useMemo(() => {
    if (!deal) return 0;
    if (!isBogo) return deal.price;
    const prices: number[] = [];
    deal.slots.forEach((slot) => {
      const state = slotStates.get(slot.slot_index);
      state?.picks.forEach((pick) => {
        if (pick.selectedItem)
          prices.push(regularPrice(pick.selectedItem, pick.config.variantId));
      });
    });
    return bogoDealTotal(prices, 1, 1, Number(deal.bogo_get_percent ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal, slotStates, isBogo]);

  // ── Live running summary (side rail) ──
  // Resolve a pick's chosen modifiers to display names (e.g. "Extra Cheese", "Pepperoni ×2").
  const modifierLabelsFor = (
    item: MenuItem,
    modifiers?: Array<{ modifierId: number; quantity: number }>,
  ): string[] => {
    if (!modifiers?.length) return [];
    const byId = new Map<number, string>();
    item.modifier_groups?.forEach((g) => g.modifiers.forEach((m) => byId.set(m.id, m.name)));
    return modifiers.map((m) => {
      const name = byId.get(m.modifierId) ?? `Option ${m.modifierId}`;
      return m.quantity && m.quantity > 1 ? `${name} ×${m.quantity}` : name;
    });
  };

  type SummaryLine = { qty: number; name: string; variantName?: string; mods: string[]; notes?: string };
  const summaryLines = useMemo(() => {
    const lines: SummaryLine[] = [];
    slots.forEach((slot) => {
      const state = slotStates.get(slot.slot_index);
      if (!state) return;
      const agg = new Map<string, SummaryLine>();
      state.picks.forEach((pick) => {
        const item = pick.selectedItem;
        if (!item) return;
        const variant =
          pick.config.variantId != null
            ? item.variants?.find((v) => v.id === pick.config.variantId)
            : undefined;
        const mods = modifierLabelsFor(item, pick.config.modifiers);
        const notes = pick.config.notes?.trim() || undefined;
        // Include the customization in the merge key so identical drinks still collapse to "2×",
        // but two pizzas with different toppings stay as separate lines.
        const modSig = (pick.config.modifiers ?? [])
          .map((m) => `${m.modifierId}:${m.quantity || 1}`)
          .sort()
          .join(',');
        const key = `${item.id}::${pick.config.variantId ?? ''}::${modSig}::${notes ?? ''}`;
        const qty = pickQuantity(slot);
        const existing = agg.get(key);
        if (existing) existing.qty += qty;
        else agg.set(key, { qty, name: item.name, variantName: variant?.name, mods, notes });
      });
      agg.forEach((v) => lines.push(v));
    });
    return lines;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, slotStates]);

  // Displayed total: the (dynamic or fixed) deal price PLUS every per-item extra the customer
  // added — size-aware toppings/modifiers, add-ons and slot surcharges. Must equal the cart's
  // line total (CartPanel: dealPrice + addons + modifiers + surcharges) so the price doesn't
  // jump when the deal lands in the cart.
  const total = useMemo(() => {
    let sum = dealTotal;
    slots.forEach((slot) => {
      const state = slotStates.get(slot.slot_index);
      state?.picks.forEach((pick) => {
        const item = pick.selectedItem;
        if (!item) return;
        const sizeKey = sizeKeyOf(item, pick.config.variantId);
        const modifiersPrice = computeModifiersPrice(
          item.modifier_groups,
          pick.config.modifiers,
          sizeKey,
        );
        const addonsPrice = (pick.config.addons ?? []).reduce((a, ad) => {
          const found = item.addons?.find((x) => x.id === ad.addonId);
          return a + (found ? Number(found.price) * ad.quantity : 0);
        }, 0);
        sum +=
          modifiersPrice +
          addonsPrice +
          slotSurchargeFor(slot, item) * pickQuantity(slot);
      });
    });
    return sum;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealTotal, slots, slotStates]);

  const handleConfirm = () => {
    if (!deal || !allSlotsComplete) return;
    const components: DealComponentLine[] = [];
    deal.slots.forEach((slot) => {
      const state = slotStates.get(slot.slot_index) ?? initSlotState(slot);
      state.picks.forEach((pick) => {
        if (!pick.selectedItem) return;
        components.push({
          menuItem: pick.selectedItem,
          quantity: pickQuantity(slot),
          slot_index: slot.slot_index,
          variantId: pick.config.variantId,
          addons: pick.config.addons ?? [],
          modifiers: pick.config.modifiers ?? [],
          notes: pick.config.notes,
          surcharge: slotSurchargeFor(slot, pick.selectedItem),
        });
      });
    });
    onConfirm({
      dealId: deal.deal_menu_item_id,
      dealName: deal.name,
      // For BOGO the bundle price is dynamic (full + cheaper-at-half of the chosen pizzas);
      // the cart adds toppings/add-ons on top. The server reprices authoritatively at order time.
      dealPrice: isBogo ? dealTotal : deal.price,
      components,
    });
    setSlotStates(new Map());
    setCustomizeTarget(null);
    setCurrentStep(0);
    onClose();
  };

  const handleClose = () => {
    setSlotStates(new Map());
    setCustomizeTarget(null);
    setCurrentStep(0);
    onClose();
  };

  const goNext = () => {
    if (!primaryEnabled) return;
    if (isLast) handleConfirm();
    else setCurrentStep(clampedStep + 1);
  };
  const goBack = () => {
    if (clampedStep > 0) setCurrentStep(clampedStep - 1);
  };
  const goToStep = (i: number) => {
    if (i < clampedStep) setCurrentStep(i);
  };

  const customizeSlot = customizeTarget ? deal?.slots.find((s) => s.slot_index === customizeTarget.slotIndex) ?? null : null;
  // Size constraints for the customize modal: a fixed lock or a forced (mirrored) size pins one
  // size; otherwise an allowed-size set (e.g. a BOGO slot 0 lets the customer pick 12" or 14").
  const customizeForcedSize = customizeSlot ? forcedSizeKeyForSlot(customizeSlot) : null;
  const customizeLockedSize = customizeSlot?.slot_size_key ?? customizeForcedSize ?? undefined;
  const customizeAllowedSizes =
    customizeSlot && !customizeLockedSize
      ? customizeSlot.allowed_size_keys ?? undefined
      : undefined;
  const customizePick = customizeTarget
    ? slotStates.get(customizeTarget.slotIndex)?.picks[customizeTarget.pickIdx] ?? null
    : null;
  const rawItemToCustomize = customizePick?.selectedItem ?? null;
  // Inside a deal, hide cross-sell groups ("Add a drink(s)", "Add a dip(s)") and add-ons —
  // the deal is a fixed bundle, so those shouldn't be offered/charged on top of it.
  const itemToCustomize = rawItemToCustomize
    ? {
        ...rawItemToCustomize,
        modifier_groups: (rawItemToCustomize.modifier_groups ?? []).filter((g) => !g.hide_in_deals),
        addons: [],
      }
    : null;
  const configToCustomize = customizePick?.config ?? { addons: [], modifiers: [] };
  const applyCustomizeConfig = (config: ItemConfig) => {
    if (customizeTarget) setPick(customizeTarget.slotIndex, customizeTarget.pickIdx, { config });
  };

  const renderStatusPill = () => {
    if (!currentSlot) return null;
    const slot = currentSlot;
    const state = getSlotState(slot.slot_index, slot);
    const base = 'flex-none text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap';
    if (slot.type === 'fixed') {
      if (state.picks.some((p) => pickNeedsOptions(slot, p))) {
        return <span className={`${base} bg-amber-50 text-amber-700`}>Options required</span>;
      }
      return <span className={`${base} bg-emerald-50 text-emerald-600`}>Included</span>;
    }
    if (isMultiPick(slot)) {
      const c = slotUnitCount(state);
      if (slot.optional) {
        return (
          <span className={`${base} bg-emerald-50 text-emerald-600`}>
            {c > 0 ? `${c} added` : 'Optional'}
          </span>
        );
      }
      const q = slot.quantity ?? 1;
      const done = c >= q;
      return (
        <span className={`${base} ${done ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-700'}`}>
          {c} of {q} selected
        </span>
      );
    }
    if (state.picks.some((p) => pickNeedsOptions(slot, p))) {
      return <span className={`${base} bg-amber-50 text-amber-700`}>Options required</span>;
    }
    const done = slotComplete(slot, state);
    return (
      <span className={`${base} ${done ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
        {done ? 'Selected' : 'Required'}
      </span>
    );
  };

  const renderStepBody = () => {
    if (!currentSlot) return null;
    const slot = currentSlot;
    const rawChoiceItems = slot.choice_items ?? [];
    const isFixed = slot.type === 'fixed' && rawChoiceItems.length <= 1;
    const multi = isMultiPick(slot);
    const state = getSlotState(slot.slot_index, slot);

    if (isFixed) {
      const item = state.picks[0]?.selectedItem ?? rawChoiceItems[0] ?? null;
      const needsOptions = state.picks.some((p) => pickNeedsOptions(slot, p));
      return (
        <div>
          <div
            className={`flex items-center gap-3 rounded-xl border-2 p-4 ${
              needsOptions ? 'border-amber-300 bg-amber-50' : 'border-emerald-200 bg-emerald-50'
            }`}
          >
            <span
              className={`flex-none w-7 h-7 rounded-full flex items-center justify-center ${
                needsOptions ? 'bg-amber-500' : 'bg-emerald-500'
              }`}
            >
              <MdCheck className="w-4 h-4 text-white" />
            </span>
            <div className="flex-1 min-w-0">
              <div
                className={`text-[11px] font-bold uppercase tracking-wide ${
                  needsOptions ? 'text-amber-600' : 'text-emerald-600'
                }`}
              >
                {needsOptions ? 'Options required' : 'Included'}
              </div>
              <div
                className={`text-base font-bold truncate ${
                  needsOptions ? 'text-amber-800' : 'text-emerald-800'
                }`}
              >
                {item?.name ?? 'Included item'}
              </div>
            </div>
            {slot.allow_customization && hasOptions(item) && (
              <button
                type="button"
                onClick={() => setCustomizeTarget({ slotIndex: slot.slot_index, pickIdx: 0 })}
                className={`flex-none px-4 py-2 rounded-lg border-[1.5px] bg-white text-sm font-bold transition-colors ${
                  needsOptions
                    ? 'border-amber-400 text-amber-700 hover:bg-amber-50'
                    : 'border-emerald-300 text-emerald-600 hover:bg-emerald-50'
                }`}
              >
                Customize
              </button>
            )}
          </div>
          <p className="mt-3 text-xs text-gray-500">
            {needsOptions
              ? 'This item has required options — tap Customize to choose them.'
              : 'Nothing to pick — this step is already complete.'}
          </p>
        </div>
      );
    }

    // A mirror slot (BOGO 2nd pizza) only offers the same-category choices, and nothing until the
    // mirrored pizza is chosen in its (earlier) step.
    const choiceItems = effectiveChoiceItems(slot);
    const chip = sizeChipLabel(slot, rawChoiceItems);
    const mirrorWaiting = slot.mirror_slot_index != null && choiceItems.length === 0;

    if (mirrorWaiting) {
      return (
        <p className="text-sm text-gray-500 italic">
          Pick the pizza in the previous step first, then choose a matching one here.
        </p>
      );
    }

    return (
      <div>
        {chip && (
          <div className="mb-4">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-100 px-3 py-1.5 text-[13px] font-semibold text-gray-700">
              <MdLock className="w-3.5 h-3.5" /> Size locked · {chip}
            </span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          {choiceItems.map((item) => {
            const surcharge = slotSurchargeFor(slot, item);
            if (multi) {
              const qty = state.picks.filter((p) => p.selectedItem?.id === item.id).length;
              const atMax = state.picks.length >= (slot.quantity ?? 1);
              const selected = qty > 0;
              const disabled = atMax && !selected;
              return (
                <DealChoiceCard
                  key={item.id}
                  item={item}
                  selected={selected}
                  disabled={disabled}
                  surcharge={surcharge}
                  onClick={disabled ? undefined : () => addUnit(slot, item)}
                  stepper={{ qty, canInc: !atMax, onInc: () => addUnit(slot, item), onDec: () => removeUnit(slot, item) }}
                />
              );
            }
            const selected = state.picks[0]?.selectedItem?.id === item.id;
            const canCustomize = selected && slot.allow_customization && hasOptions(item);
            return (
              <DealChoiceCard
                key={item.id}
                item={item}
                selected={selected}
                surcharge={surcharge}
                onClick={() => selectSingle(slot, item)}
                onCustomize={canCustomize ? () => setCustomizeTarget({ slotIndex: slot.slot_index, pickIdx: 0 }) : undefined}
              />
            );
          })}
        </div>
        {!multi && state.picks[0] && pickNeedsOptions(slot, state.picks[0]) && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm font-semibold text-amber-800">
              {state.picks[0].selectedItem?.name} has required options (base, toppings, …) — choose
              them before continuing.
            </p>
            <button
              type="button"
              onClick={() => setCustomizeTarget({ slotIndex: slot.slot_index, pickIdx: 0 })}
              className="flex-none px-4 py-2 rounded-lg bg-amber-500 text-sm font-bold text-white hover:bg-amber-600 transition-colors"
            >
              Customize
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <AnimatePresence>
        {isOpen && deal && (
          <>
            <motion.div
              className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handleClose}
            />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <motion.div
                className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col overflow-hidden"
                style={{ height: '90vh', maxHeight: '90vh' }}
                initial={{ opacity: 0, scale: 0.96, y: 24 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 24 }}
                transition={{ type: 'spring', damping: 30, stiffness: 400 }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Accent stripe */}
                <div className="h-1.5 bg-gradient-to-r from-red-500 via-red-600 to-rose-500 flex-none" />

                {/* Header + progress */}
                <div className="flex-none px-8 pt-6 pb-5 border-b border-gray-100">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <span className="inline-block text-[10px] font-extrabold uppercase tracking-[0.15em] text-red-600 bg-red-50 rounded-full px-2.5 py-1">
                        Step {clampedStep + 1} / {stepCount}
                      </span>
                      <h2 className="text-xl font-bold text-gray-900 mt-2.5 truncate">Configure: {deal.name}</h2>
                      <p className="text-[13.5px] text-gray-500 mt-0.5">
                        {isBogo ? 'Buy one get one — 2nd pizza ½ price' : `Fixed deal price · ${formatCurrency(deal.price)}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleClose}
                      className="flex-none w-10 h-10 rounded-xl bg-gray-100 text-gray-500 hover:bg-gray-200 flex items-center justify-center transition-colors"
                      aria-label="Close"
                    >
                      <MdClose className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="mt-4 flex gap-2">
                    {slots.map((s, i) => {
                      const done = i < clampedStep;
                      const current = i === clampedStep;
                      return (
                        <div key={s.slot_index} className="flex-1 min-w-0">
                          <button
                            type="button"
                            disabled={!done}
                            onClick={() => goToStep(i)}
                            aria-label={`Go to ${stepLabel(s, i)}`}
                            className={`w-full h-2.5 rounded-full transition-all ${
                              done
                                ? 'bg-emerald-400 cursor-pointer hover:bg-emerald-500'
                                : current
                                  ? 'bg-red-500 cursor-default'
                                  : 'bg-gray-200 cursor-default'
                            }`}
                          />
                          <span
                            className={`block text-[11px] text-center font-semibold truncate mt-1.5 ${
                              current ? 'text-red-600' : done ? 'text-emerald-600' : 'text-gray-400'
                            }`}
                          >
                            {stepLabel(s, i)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Step-title band */}
                <div className="flex-none flex items-center justify-between gap-3 px-8 py-4 bg-gray-50 border-b border-gray-100">
                  <h3 className="text-lg font-bold text-gray-900 truncate min-w-0">
                    {currentSlot ? stepTitle(currentSlot) : ''}
                  </h3>
                  {renderStatusPill()}
                </div>

                {/* Body: choice grid + side rail */}
                <div className="flex-1 min-h-0 flex">
                  <div className="flex-1 min-w-0 overflow-y-auto px-6 py-5">{renderStepBody()}</div>

                  <aside className="w-[266px] flex-none border-l border-gray-100 bg-white flex flex-col">
                    <div className="flex-none px-5 pt-4 pb-3 border-b border-gray-100">
                      <div className="text-[10.5px] font-bold uppercase tracking-wide text-gray-400">Your deal</div>
                      <div className="text-base font-bold text-gray-900 mt-1 truncate">{deal.name}</div>
                      <div className="text-[12.5px] text-gray-500">
                        {isBogo ? '2nd pizza ½ price' : `Fixed · ${formatCurrency(deal.price)}`}
                      </div>
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto px-5 py-2">
                      {summaryLines.length === 0 ? (
                        <div className="py-3 text-[13px] text-gray-400 leading-relaxed">
                          Items you pick will appear here.
                        </div>
                      ) : (
                        summaryLines.map((ln, i) => (
                          <div key={i} className="flex items-start gap-2.5 py-2.5 border-b border-gray-50 last:border-b-0">
                            <span className="flex-none text-[13px] font-extrabold text-red-600 tabular-nums">{ln.qty}×</span>
                            <div className="min-w-0">
                              <div className="text-[13.5px] text-gray-700 leading-snug">
                                {ln.name}
                                {ln.variantName ? <span className="text-gray-400"> — {ln.variantName}</span> : null}
                              </div>
                              {ln.mods.length > 0 && (
                                <ul className="mt-0.5 space-y-0.5">
                                  {ln.mods.map((m, j) => (
                                    <li key={j} className="text-[12px] text-gray-500 leading-snug">+ {m}</li>
                                  ))}
                                </ul>
                              )}
                              {ln.notes && (
                                <div className="mt-0.5 text-[12px] italic text-gray-400 leading-snug">Note: {ln.notes}</div>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                    <div className="flex-none border-t border-gray-100 px-5 py-3.5 bg-gray-50">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Total</span>
                        <span className="text-[21px] font-black text-gray-900 tabular-nums">{formatCurrency(total)}</span>
                      </div>
                    </div>
                  </aside>
                </div>

                {/* Footer */}
                <div className="flex-none flex items-center justify-end gap-3 px-8 py-4 bg-gray-50 border-t border-gray-200">
                  {clampedStep > 0 && (
                    <button
                      type="button"
                      onClick={goBack}
                      className="px-5 py-3 rounded-xl border-2 border-gray-300 bg-white text-[15px] font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      ← Back
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={goNext}
                    disabled={!primaryEnabled}
                    className={`px-7 py-3.5 rounded-xl text-[15px] font-bold transition-all ${
                      primaryEnabled
                        ? 'bg-red-600 text-white hover:bg-red-700 active:scale-95 shadow-md shadow-red-200'
                        : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    {isLast ? (initialComponents ? 'Update deal' : 'Add Deal to Order') : 'Next →'}
                  </button>
                </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>

      <ItemConfigModal
        isOpen={customizeTarget != null && !!itemToCustomize}
        onClose={() => setCustomizeTarget(null)}
        item={itemToCustomize ?? null}
        lockedSizeKey={customizeLockedSize}
        allowedSizeKeys={customizeAllowedSizes}
        hideRunningTotal
        config={configToCustomize}
        onConfigChange={(config) => applyCustomizeConfig(config)}
        onConfirm={() => setCustomizeTarget(null)}
        onToggleAddon={(addonId) => {
          const current = configToCustomize.addons ?? [];
          const exists = current.some((a) => a.addonId === addonId);
          const newAddons = exists
            ? current.filter((a) => a.addonId !== addonId)
            : [...current, { addonId, quantity: 1 }];
          applyCustomizeConfig({ ...configToCustomize, addons: newAddons });
        }}
        onToggleModifier={(modifierId) => {
          const current = configToCustomize.modifiers ?? [];
          const exists = current.some((m) => m.modifierId === modifierId);
          const groupForModifier = itemToCustomize?.modifier_groups?.find((g) =>
            g.modifiers.some((m) => m.id === modifierId),
          );
          const customizeSizeKey =
            customizeLockedSize ?? sizeKeyOf(itemToCustomize, configToCustomize.variantId);
          const isSingleSelect =
            groupForModifier && (resolveMaxSelect(groupForModifier, customizeSizeKey) ?? 0) === 1;

          if (exists) {
            applyCustomizeConfig({ ...configToCustomize, modifiers: current.filter((m) => m.modifierId !== modifierId) });
            return;
          }
          if (isSingleSelect && groupForModifier) {
            const clearedOthers = current.filter((m) => {
              const g = itemToCustomize?.modifier_groups?.find((gr) =>
                gr.modifiers.some((mod) => mod.id === m.modifierId),
              );
              return g?.id !== groupForModifier.id;
            });
            applyCustomizeConfig({ ...configToCustomize, modifiers: [...clearedOthers, { modifierId, quantity: 1 }] });
            return;
          }
          applyCustomizeConfig({ ...configToCustomize, modifiers: [...current, { modifierId, quantity: 1 }] });
        }}
        onUpdateAddonQuantity={(addonId, quantity) => {
          const current = configToCustomize.addons ?? [];
          const newAddons = current.map((a) => (a.addonId === addonId ? { ...a, quantity } : a));
          applyCustomizeConfig({ ...configToCustomize, addons: newAddons });
        }}
        onUpdateModifierQuantity={(modifierId, quantity) => {
          let next = Math.max(0, Math.floor(quantity));
          const group = itemToCustomize?.modifier_groups?.find((g) => g.modifiers.some((m) => m.id === modifierId));
          if (group && next > 0) {
            const max =
              resolveMaxSelect(
                group,
                customizeLockedSize ?? sizeKeyOf(itemToCustomize, configToCustomize.variantId),
              ) ?? 99;
            const otherUnits = (configToCustomize.modifiers ?? [])
              .filter((m) => m.modifierId !== modifierId && group.modifiers.some((mod) => mod.id === m.modifierId))
              .reduce((s, m) => s + (m.quantity || 1), 0);
            next = Math.min(next, Math.max(0, max - otherUnits));
          }
          const newMods = (configToCustomize.modifiers ?? [])
            .map((m) => (m.modifierId === modifierId ? { ...m, quantity: next } : m))
            .filter((m) => m.quantity > 0);
          applyCustomizeConfig({ ...configToCustomize, modifiers: newMods });
        }}
      />
    </>
  );
};

type DealChoiceCardProps = {
  item: MenuItem;
  selected: boolean;
  disabled?: boolean;
  surcharge: number;
  onClick?: () => void;
  onCustomize?: () => void;
  stepper?: { qty: number; canInc: boolean; onInc: () => void; onDec: () => void };
};

const DealChoiceCard: React.FC<DealChoiceCardProps> = ({
  item,
  selected,
  disabled,
  surcharge,
  onClick,
  onCustomize,
  stepper,
}) => {
  const isSignature = (item.label ?? '').toLowerCase() === 'signature';
  return (
    <div
      onClick={disabled ? undefined : onClick}
      className={`relative flex items-center gap-3 rounded-xl border-2 p-4 transition-all ${
        selected
          ? 'border-red-500 bg-red-50 shadow-sm'
          : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
      } ${disabled ? 'opacity-45 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`flex-none w-5 h-5 rounded-full border-2 flex items-center justify-center ${
          selected ? 'border-red-500 bg-red-500' : 'border-gray-300 bg-white'
        }`}
      >
        {selected && <span className="w-2 h-2 rounded-full bg-white" />}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[15px] font-semibold ${selected ? 'text-red-700' : 'text-gray-900'}`}>
            {item.name}
          </span>
          {item.label && (
            <span
              className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                isSignature ? 'bg-red-600 text-white' : 'bg-red-50 text-red-600'
              }`}
            >
              {item.label}
            </span>
          )}
        </div>
        {surcharge > 0 && (
          <div className="mt-1.5">
            <span className="inline-block text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-0.5">
              + {formatCurrency(surcharge)}
            </span>
          </div>
        )}
        {onCustomize && (
          <div className="mt-1 flex justify-end">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCustomize();
              }}
              className="text-[13px] font-semibold text-red-600 hover:text-red-700"
            >
              Customize ›
            </button>
          </div>
        )}
      </div>
      {stepper && stepper.qty > 0 ? (
        <span className="flex-none inline-flex items-center overflow-hidden rounded-lg border border-red-200 bg-white" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            aria-label="Remove one"
            onClick={stepper.onDec}
            className="w-8 h-8 flex items-center justify-center text-red-600 hover:bg-red-50 transition-colors"
          >
            <MdRemove className="w-4 h-4" />
          </button>
          <span className="min-w-[24px] text-center text-[15px] font-bold tabular-nums text-gray-900">{stepper.qty}</span>
          <button
            type="button"
            aria-label="Add one"
            onClick={stepper.onInc}
            disabled={!stepper.canInc}
            className="w-8 h-8 flex items-center justify-center text-red-600 hover:bg-red-50 disabled:text-gray-300 disabled:hover:bg-transparent transition-colors"
          >
            <MdAdd className="w-4 h-4" />
          </button>
        </span>
      ) : selected && !stepper ? (
        <MdCheckCircle className="flex-none w-5 h-5 text-red-500" />
      ) : null}
    </div>
  );
};

export default DealConfigModal;

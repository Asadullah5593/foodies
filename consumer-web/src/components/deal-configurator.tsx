"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ItemConfigModal, type ConfigValue } from "@/components/item-config-modal";
import { computeModifiersPrice, resolveMinSelect } from "@/lib/modifier-pricing";
import type { Deal, DealSlot, MenuItem } from "@/lib/api/types";

/** One independent selection within a slot. A multi-quantity choice slot has one pick per unit. */
type SlotPick = { item: MenuItem | null; config: ConfigValue };
type SlotState = { picks: SlotPick[] };

const emptyConfig = (variantId?: number): ConfigValue => ({
  quantity: 1,
  variant_id: variantId,
  addons: [],
  modifiers: [],
});

// ── Pure helpers (ported from POS DealConfigModal — same rules) ─────────────────
const isMultiPick = (slot: DealSlot) => slot.type !== "fixed" && (slot.quantity ?? 1) > 1;
const pickQuantity = (slot: DealSlot) => (isMultiPick(slot) ? 1 : slot.quantity ?? 1);

const slotSurchargeFor = (slot: DealSlot, item: MenuItem | null): number =>
  item ? Number(slot.slot_surcharges?.[String(item.id)] ?? 0) : 0;

/** What can still be customized inside a deal: variants and modifier groups (add-ons are hidden). */
const hasOptions = (item: MenuItem | null) =>
  !!item && !!(item.variants?.length || item.modifier_groups?.length);

const defaultVariantId = (item: MenuItem | null): number | undefined => {
  if (!item?.variants?.length) return undefined;
  return (
    item.variants.find((v) => v.is_default === true || v.isDefault === true)?.id ??
    item.variants[0]?.id
  );
};

const sizeKeyOf = (item: MenuItem | null, variantId?: number): string | null =>
  item?.variants?.find((v) => v.id === variantId)?.size_key ?? null;

/** Strict pairing key for a BOGO mirror slot: same catalog category AND label. */
const pairKey = (item?: MenuItem | null): string =>
  item ? `${item.category_id ?? ""}|${item.label ?? ""}` : "";

const regularPrice = (item: MenuItem | null | undefined, variantId?: number): number => {
  if (!item) return 0;
  const base = Number(item.price ?? item.base_price ?? 0);
  const mod = Number(item.variants?.find((v) => v.id === variantId)?.price_modifier ?? 0);
  return base + mod;
};

/** Pre-select a variant honouring a size lock / allowed sizes / forced (mirrored) size, else default. */
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
  return defaultVariantId(item);
};

/** A picked item whose REQUIRED modifier groups haven't been satisfied yet (mirrors POS). */
const pickNeedsOptions = (slot: DealSlot, pick: SlotPick): boolean => {
  const item = pick.item;
  if (!item || !slot.allow_customization || isMultiPick(slot)) return false;
  const config = pick.config;
  if ((item.variants?.length ?? 0) > 0 && config.variant_id == null) return true;
  const sizeKey = slot.slot_size_key ?? sizeKeyOf(item, config.variant_id);
  const selectedIds = new Set((config.modifiers ?? []).map((m) => m.modifier_id));
  for (const g of item.modifier_groups ?? []) {
    const triggers = g.visible_when_modifier_ids;
    if (triggers?.length && !triggers.some((id) => selectedIds.has(id))) continue;
    const min = resolveMinSelect(g, sizeKey);
    if (min <= 0) continue;
    const units = (config.modifiers ?? [])
      .filter((m) => g.modifiers.some((mod) => mod.id === m.modifier_id))
      .reduce((s, m) => s + (m.quantity || 1), 0);
    if (units < min) return true;
  }
  return false;
};

/** BOGO pricing mirror (client): cheapest getQ per (buyQ+getQ) cohort discounted pct%. */
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const bogoDealTotal = (prices: number[], pct: number): number => {
  const p = Math.min(100, Math.max(0, Number(pct) || 0));
  if (!prices.length) return 0;
  if (p <= 0) return round2(prices.reduce((a, b) => a + b, 0));
  const order = prices.map((price, i) => ({ price: Number(price) || 0, i })).sort((a, c) => c.price - a.price);
  const discounts = new Array<number>(prices.length).fill(0);
  const cohort = 2; // buy 1 + get 1
  for (let start = 0; start + cohort <= order.length; start += cohort) {
    const unit = order[start + cohort - 1];
    discounts[unit.i] = (unit.price * p) / 100;
  }
  return round2(prices.reduce((sum, price, i) => sum + ((Number(price) || 0) - discounts[i]), 0));
};

const currency = (n: number) => `Rs.${Math.round(n)}`;

function modifierSummary(item: MenuItem, config: ConfigValue): string[] {
  const byId = new Map<number, string>();
  item.modifier_groups?.forEach((g) => g.modifiers.forEach((m) => byId.set(m.id, m.name)));
  const parts: string[] = [];
  const variant = item.variants?.find((v) => v.id === config.variant_id);
  if (variant && item.variants && item.variants.length > 1) parts.push(variant.name);
  (config.modifiers ?? []).forEach((m) => {
    const name = byId.get(m.modifier_id);
    if (name) parts.push(m.quantity && m.quantity > 1 ? `${name} ×${m.quantity}` : name);
  });
  return parts;
}

function initSlotState(slot: DealSlot): SlotState {
  if (slot.type === "fixed" && slot.choice_items?.length) {
    const item = slot.choice_items[0] ?? null;
    return { picks: [{ item, config: emptyConfig(variantIdForSlot(item, slot)) }] };
  }
  if (slot.type === "choice_category" || slot.type === "choice_list") {
    // A mirror slot (BOGO 2nd pizza) starts empty — it can't be pre-filled before the
    // slot it mirrors has a pick to match category/size against.
    if (isMultiPick(slot) || slot.mirror_slot_index != null) return { picks: [] };
    const first = slot.choice_items?.[0] ?? null;
    return { picks: [{ item: first, config: emptyConfig(variantIdForSlot(first, slot)) }] };
  }
  return { picks: [{ item: null, config: emptyConfig() }] };
}

// ── Component ───────────────────────────────────────────────────────────────
export function DealConfigurator({
  deal,
  onTotalChange,
}: {
  deal: Deal;
  onTotalChange?: (total: number) => void;
}) {
  const slots = useMemo(
    () => (deal.slots ?? []).filter((s) => s.type === "fixed" || (s.choice_items?.length ?? 0) > 0),
    [deal.slots],
  );

  const [slotStates, setSlotStates] = useState<Map<number, SlotState>>(new Map());
  const [customize, setCustomize] = useState<{ slotIndex: number; pickIdx: number } | null>(null);

  // (Re)initialise whenever the deal changes.
  useEffect(() => {
    const init = new Map<number, SlotState>();
    slots.forEach((slot) => init.set(slot.slot_index, initSlotState(slot)));
    setSlotStates(init);
    setCustomize(null);
  }, [deal.deal_menu_item_id, slots]);

  const getState = (slot: DealSlot): SlotState =>
    slotStates.get(slot.slot_index) ?? initSlotState(slot);

  const setState = (slotIndex: number, updater: (s: SlotState) => SlotState) => {
    setSlotStates((prev) => {
      const next = new Map(prev);
      const slot = slots.find((s) => s.slot_index === slotIndex)!;
      next.set(slotIndex, updater(prev.get(slotIndex) ?? initSlotState(slot)));
      return next;
    });
  };

  // ── Mirror-slot (BOGO) helpers: a mirror slot must match the pick of the slot it mirrors ──
  const mirroredPickOf = (slot: DealSlot): SlotPick | null =>
    slot.mirror_slot_index != null
      ? slotStates.get(slot.mirror_slot_index)?.picks[0] ?? null
      : null;
  /** The size this slot is forced to (its mirrored slot's chosen size), if any. */
  const forcedSizeKeyForSlot = (slot: DealSlot | null): string | null => {
    if (!slot || slot.mirror_slot_index == null || !slot.mirror_match_size) return null;
    const m = mirroredPickOf(slot);
    return m?.item ? sizeKeyOf(m.item, m.config.variant_id) : null;
  };
  /** Choices a mirror slot may offer: same (category,label) and/or size as the mirrored pick. */
  const effectiveChoiceItems = (slot: DealSlot): MenuItem[] => {
    const items = slot.choice_items ?? [];
    if (slot.mirror_slot_index == null) return items;
    if (!slot.mirror_match_category && !slot.mirror_match_size) return items;
    const m = mirroredPickOf(slot);
    if (!m?.item) return [];
    let result = items;
    if (slot.mirror_match_category) result = result.filter((it) => pairKey(it) === pairKey(m.item));
    if (slot.mirror_match_size) {
      const ms = sizeKeyOf(m.item, m.config.variant_id);
      if (ms) result = result.filter((it) => it.variants?.some((v) => (v.size_key ?? null) === ms));
    }
    return result;
  };

  const selectSingle = (slot: DealSlot, item: MenuItem) =>
    setState(slot.slot_index, () => ({
      picks: [{ item, config: emptyConfig(variantIdForSlot(item, slot, forcedSizeKeyForSlot(slot))) }],
    }));

  const unitQty = (state: SlotState, item: MenuItem) =>
    state.picks.filter((p) => p.item?.id === item.id).length;

  const addUnit = (slot: DealSlot, item: MenuItem) =>
    setState(slot.slot_index, (s) => {
      if (s.picks.length >= (slot.quantity ?? 1)) return s;
      return {
        picks: [...s.picks, { item, config: emptyConfig(variantIdForSlot(item, slot, forcedSizeKeyForSlot(slot))) }],
      };
    });

  const removeUnit = (slot: DealSlot, item: MenuItem) =>
    setState(slot.slot_index, (s) => {
      const idx = s.picks.map((p) => p.item?.id).lastIndexOf(item.id);
      if (idx === -1) return s;
      const picks = s.picks.slice();
      picks.splice(idx, 1);
      return { picks };
    });

  // ── Live running total (mirrors POS: deal price + surcharges + modifier charges) ──
  const isBogo = deal.pricing_mode === "bogo";
  const total = useMemo(() => {
    let base: number;
    if (isBogo) {
      const prices: number[] = [];
      slots.forEach((slot) => {
        getState(slot).picks.forEach((pick) => {
          if (pick.item) prices.push(regularPrice(pick.item, pick.config.variant_id));
        });
      });
      base = bogoDealTotal(prices, Number(deal.bogo_get_percent ?? 0));
    } else {
      base = deal.price;
    }
    let sum = base;
    slots.forEach((slot) => {
      getState(slot).picks.forEach((pick) => {
        const item = pick.item;
        if (!item) return;
        const sizeKey = sizeKeyOf(item, pick.config.variant_id);
        sum += computeModifiersPrice(item.modifier_groups, pick.config.modifiers, sizeKey);
        sum += slotSurchargeFor(slot, item) * pickQuantity(slot);
      });
    });
    return round2(sum);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, slotStates, deal, isBogo]);

  const onTotalRef = useRef(onTotalChange);
  onTotalRef.current = onTotalChange;
  useEffect(() => {
    onTotalRef.current?.(total);
  }, [total]);

  // Keep mirror slots (BOGO 2nd pizza) consistent with the slot they mirror: clear a pick that
  // no longer matches the mirrored category, and force its size to the mirrored size. Converges
  // in one pass (mirrors POS DealConfigModal).
  useEffect(() => {
    for (const slot of slots) {
      if (slot.mirror_slot_index == null) continue;
      const m = slotStates.get(slot.mirror_slot_index)?.picks[0] ?? null;
      const mirroredItem = m?.item ?? null;
      const mirroredSize = mirroredItem ? sizeKeyOf(mirroredItem, m?.config.variant_id) : null;
      const state = slotStates.get(slot.slot_index);
      if (!state) continue;
      state.picks.forEach((pick, pickIdx) => {
        if (!pick.item) return;
        const catOk =
          !slot.mirror_match_category ||
          (mirroredItem != null && pairKey(pick.item) === pairKey(mirroredItem));
        if (!catOk) {
          setState(slot.slot_index, (s) => {
            const picks = s.picks.slice();
            picks[pickIdx] = { item: null, config: emptyConfig() };
            return { picks };
          });
          return;
        }
        if (slot.mirror_match_size && mirroredSize) {
          const curSize = sizeKeyOf(pick.item, pick.config.variant_id);
          if (curSize !== mirroredSize) {
            const targetVariantId = pick.item.variants?.find(
              (v) => (v.size_key ?? null) === mirroredSize,
            )?.id;
            setState(slot.slot_index, (s) => {
              const picks = s.picks.slice();
              picks[pickIdx] =
                targetVariantId == null
                  ? { item: null, config: emptyConfig() }
                  : { ...picks[pickIdx]!, config: { ...picks[pickIdx]!.config, variant_id: targetVariantId } };
              return { picks };
            });
          }
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotStates, slots]);

  // ── Customize modal wiring (nested item options; add-ons hidden inside deals) ──
  const customizeSlot = customize ? slots.find((s) => s.slot_index === customize.slotIndex) ?? null : null;
  const customizePick =
    customize != null ? slotStates.get(customize.slotIndex)?.picks[customize.pickIdx] ?? null : null;
  const itemToCustomize = customizePick?.item
    ? ({ ...customizePick.item, addons: [] } as MenuItem)
    : null;

  return (
    <div className="mt-5 sm:mt-6">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-[var(--muted)] sm:text-xs">
        Build your deal
      </p>
      <div className="space-y-3">
        {slots.map((slot) => {
          const choiceItems = effectiveChoiceItems(slot);
          return (
            <SlotSection
              key={slot.slot_index}
              slot={slot}
              state={getState(slot)}
              choiceItems={choiceItems}
              mirrorWaiting={slot.mirror_slot_index != null && choiceItems.length === 0}
              unitQty={unitQty}
              onSelectSingle={(item) => selectSingle(slot, item)}
              onAddUnit={(item) => addUnit(slot, item)}
              onRemoveUnit={(item) => removeUnit(slot, item)}
              onCustomize={(pickIdx) => setCustomize({ slotIndex: slot.slot_index, pickIdx })}
            />
          );
        })}
      </div>

      <div className="mt-4 flex items-baseline justify-between rounded-xl border border-neutral-200 bg-neutral-50/70 px-4 py-3">
        <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
          Deal total
        </span>
        <span className="text-xl font-black tabular-nums text-red-600">{currency(total)}</span>
      </div>

      <ItemConfigModal
        // Fresh mount per pick so `initialValue` (pre-selected size-locked variant + prior
        // choices) is honoured — the modal reads it only in its state initialisers.
        key={customize ? `${customize.slotIndex}-${customize.pickIdx}-${itemToCustomize?.id}` : "deal-cfg-closed"}
        item={itemToCustomize}
        open={customize != null && itemToCustomize != null}
        onClose={() => setCustomize(null)}
        initialValue={customizePick?.config}
        confirmLabel="Save options"
        showItemPrice={false}
        // A size-locked deal slot pins the nested item's size (e.g. a 7"-only pizza deal);
        // an allowed-size slot restricts the picker — matching POS DealConfigModal.
        lockedSizeKey={
          (customizeSlot?.slot_size_key ?? forcedSizeKeyForSlot(customizeSlot)) ?? undefined
        }
        allowedSizeKeys={
          customizeSlot && !customizeSlot.slot_size_key
            ? customizeSlot.allowed_size_keys ?? undefined
            : undefined
        }
        onConfirm={(value) => {
          if (customize && customizeSlot) {
            setState(customize.slotIndex, (s) => {
              const picks = s.picks.slice();
              if (picks[customize.pickIdx]) {
                picks[customize.pickIdx] = { ...picks[customize.pickIdx], config: value };
              }
              return { picks };
            });
          }
          setCustomize(null);
        }}
      />
    </div>
  );
}

// ── One slot rendered as a section (title + rule message + status + choices) ───
function SlotSection({
  slot,
  state,
  choiceItems,
  mirrorWaiting,
  unitQty,
  onSelectSingle,
  onAddUnit,
  onRemoveUnit,
  onCustomize,
}: {
  slot: DealSlot;
  state: SlotState;
  choiceItems: MenuItem[];
  mirrorWaiting: boolean;
  unitQty: (state: SlotState, item: MenuItem) => number;
  onSelectSingle: (item: MenuItem) => void;
  onAddUnit: (item: MenuItem) => void;
  onRemoveUnit: (item: MenuItem) => void;
  onCustomize: (pickIdx: number) => void;
}) {
  const items = choiceItems;
  const isFixed = slot.type === "fixed" && items.length <= 1;
  const multi = isMultiPick(slot);
  const q = slot.quantity ?? 1;
  const count = state.picks.filter((p) => p.item != null).length;
  const needsOptions = state.picks.some((p) => pickNeedsOptions(slot, p));

  const title = isFixed
    ? "Included"
    : slot.optional
      ? "Add-ons"
      : multi
        ? `Choose ${q}`
        : "Choose 1";

  const rule = isFixed
    ? "Comes with your deal"
    : slot.optional
      ? "Optional — add any you like, extra charges apply"
      : multi
        ? `Pick any ${q} — mix & match`
        : "Pick one option";

  // Status pill
  const pill = (() => {
    if (isFixed)
      return needsOptions
        ? { text: "Options required", c: "bg-amber-50 text-amber-700" }
        : { text: "Included", c: "bg-emerald-50 text-emerald-700" };
    if (multi) {
      if (slot.optional) return { text: count > 0 ? `${count} added` : "Optional", c: "bg-neutral-100 text-neutral-600" };
      return count >= q
        ? { text: `${count} of ${q}`, c: "bg-emerald-50 text-emerald-700" }
        : { text: `${count} of ${q}`, c: "bg-amber-50 text-amber-700" };
    }
    if (needsOptions) return { text: "Options required", c: "bg-amber-50 text-amber-700" };
    return count >= 1
      ? { text: "Selected", c: "bg-emerald-50 text-emerald-700" }
      : { text: "Required", c: "bg-red-50 text-red-600" };
  })();

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-neutral-100 bg-neutral-50/60 px-3.5 py-2.5">
        <div className="min-w-0">
          <p className="text-[14px] font-bold leading-tight text-[var(--foreground)]">{title}</p>
          <p className="text-[11.5px] leading-tight text-[var(--muted)]">{rule}</p>
        </div>
        <span className={clsx("shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold", pill.c)}>
          {pill.text}
        </span>
      </div>

      <div className="p-2.5">
        {mirrorWaiting ? (
          <p className="px-1 py-3 text-[13px] italic text-[var(--muted)]">
            Pick the item in the previous step first, then choose a matching one here.
          </p>
        ) : isFixed ? (
          <FixedRow
            slot={slot}
            pick={state.picks[0] ?? { item: items[0] ?? null, config: emptyConfig() }}
            onCustomize={() => onCustomize(0)}
          />
        ) : (
          <div className={clsx("grid gap-2", !multi && "sm:grid-cols-2")}>
            {items.map((item) => {
              const surcharge = slotSurchargeFor(slot, item);
              if (multi) {
                const qty = unitQty(state, item);
                const atMax = count >= q;
                return (
                  <ChoiceRow
                    key={item.id}
                    item={item}
                    surcharge={surcharge}
                    selected={qty > 0}
                    multi
                    qty={qty}
                    canInc={!atMax}
                    onInc={() => onAddUnit(item)}
                    onDec={() => onRemoveUnit(item)}
                  />
                );
              }
              const selected = state.picks[0]?.item?.id === item.id;
              const canCustomize = selected && !!slot.allow_customization && hasOptions(item);
              return (
                <ChoiceRow
                  key={item.id}
                  item={item}
                  surcharge={surcharge}
                  selected={selected}
                  onSelect={() => onSelectSingle(item)}
                  onCustomize={canCustomize ? () => onCustomize(0) : undefined}
                  chosen={
                    selected && slot.allow_customization
                      ? modifierSummary(item, state.picks[0]!.config)
                      : []
                  }
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function FixedRow({
  slot,
  pick,
  onCustomize,
}: {
  slot: DealSlot;
  pick: SlotPick;
  onCustomize: () => void;
}) {
  const item = pick.item;
  const needs = pickNeedsOptions(slot, pick);
  const canCustomize = !!slot.allow_customization && hasOptions(item);
  const chosen = item && slot.allow_customization ? modifierSummary(item, pick.config) : [];
  return (
    <div
      className={clsx(
        "flex items-center gap-2.5 rounded-lg border px-3 py-2.5",
        needs ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50/60",
      )}
    >
      <span
        className={clsx(
          "grid h-5 w-5 shrink-0 place-items-center rounded-full text-white",
          needs ? "bg-amber-500" : "bg-emerald-500",
        )}
      >
        <svg viewBox="0 0 20 20" fill="none" className="h-3 w-3" aria-hidden>
          <path d="M5 10.5 8.2 13.7 15 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-bold text-[var(--foreground)]">{item?.name ?? "Included item"}</p>
        {chosen.length ? (
          <p className="truncate text-[12px] text-[var(--muted)]">{chosen.join(" · ")}</p>
        ) : needs ? (
          <p className="text-[12px] font-semibold text-amber-700">Tap Customize to choose required options</p>
        ) : null}
      </div>
      {canCustomize ? (
        <button
          type="button"
          onClick={onCustomize}
          className={clsx(
            "shrink-0 rounded-lg border px-3 py-1.5 text-[13px] font-bold transition-colors",
            needs
              ? "border-amber-400 bg-white text-amber-700 hover:bg-amber-50"
              : "border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50",
          )}
        >
          Customize
        </button>
      ) : null}
    </div>
  );
}

function ChoiceRow({
  item,
  surcharge,
  selected,
  multi,
  qty,
  canInc,
  onInc,
  onDec,
  onSelect,
  onCustomize,
  chosen,
}: {
  item: MenuItem;
  surcharge: number;
  selected: boolean;
  multi?: boolean;
  qty?: number;
  canInc?: boolean;
  onInc?: () => void;
  onDec?: () => void;
  onSelect?: () => void;
  onCustomize?: () => void;
  chosen?: string[];
}) {
  const priceLabel =
    surcharge > 0 ? `+ ${currency(surcharge)}` : "Included";
  return (
    <div
      className={clsx(
        "rounded-lg border px-3 py-2 transition-colors",
        selected ? "border-red-600 bg-red-50" : "border-neutral-200 bg-white",
      )}
    >
      <div className="flex items-center gap-2.5">
        {multi ? (
          <span
            className={clsx(
              "grid h-5 w-5 shrink-0 place-items-center rounded-md border-[1.6px]",
              selected ? "border-red-600 bg-red-600 text-white" : "border-neutral-300 bg-white text-transparent",
            )}
          >
            <svg viewBox="0 0 20 20" fill="none" className="h-3 w-3" aria-hidden>
              <path d="M5 10.5 8.2 13.7 15 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        ) : (
          <button
            type="button"
            onClick={onSelect}
            aria-pressed={selected}
            className={clsx(
              "grid h-5 w-5 shrink-0 place-items-center rounded-full border-[1.6px] focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500",
              selected ? "border-red-600" : "border-neutral-300",
            )}
          >
            {selected ? <span className="h-2.5 w-2.5 rounded-full bg-red-600" /> : null}
          </button>
        )}
        <button
          type="button"
          onClick={multi ? (canInc ? onInc : undefined) : onSelect}
          className="min-w-0 flex-1 text-left focus:outline-none"
        >
          <span
            className={clsx(
              "block truncate text-[14px] font-semibold",
              selected ? "text-red-600" : "text-[var(--foreground)]",
            )}
          >
            {item.name}
          </span>
        </button>
        <span
          className={clsx(
            "shrink-0 text-[13px] font-bold tabular-nums",
            surcharge > 0 ? "text-neutral-600" : "text-emerald-600",
          )}
        >
          {priceLabel}
        </span>
        {multi ? (
          <div className="ml-1 inline-flex shrink-0 items-center overflow-hidden rounded-lg border border-neutral-300 bg-white">
            <button
              type="button"
              aria-label={`Remove ${item.name}`}
              onClick={onDec}
              disabled={!qty}
              className="px-2 py-1 text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-40"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
                <path d="M5 12h14" strokeLinecap="round" />
              </svg>
            </button>
            <span className="min-w-[1.6rem] px-0.5 text-center text-[13px] font-bold tabular-nums">{qty ?? 0}</span>
            <button
              type="button"
              aria-label={`Add ${item.name}`}
              onClick={onInc}
              disabled={!canInc}
              className="px-2 py-1 text-neutral-600 transition hover:bg-neutral-100 disabled:opacity-40"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
                <path d="M12 5v14M5 12h14" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        ) : null}
      </div>
      {!multi && selected && (chosen?.length || onCustomize) ? (
        <div className="mt-1.5 flex items-center justify-between gap-2 pl-7">
          <span className="min-w-0 truncate text-[12px] text-[var(--muted)]">
            {chosen?.length ? chosen.join(" · ") : "Customize options"}
          </span>
          {onCustomize ? (
            <button
              type="button"
              onClick={onCustomize}
              className="shrink-0 rounded-md border border-red-200 bg-white px-2.5 py-1 text-[12px] font-bold text-red-600 hover:bg-red-50"
            >
              Customize
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

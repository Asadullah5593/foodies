"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { CartAddon, CartModifier, MenuItem } from "@/lib/api/types";
import { Button, Card, Input } from "@/components/ui";
import { toImageUrl } from "@/lib/api/client";
import {
  computeModifiersPrice,
  resolveModifierUnitPrice,
  sizeKeyForVariant,
} from "@/lib/modifier-pricing";
import Image from "next/image";

export type ConfigValue = {
  quantity: number;
  variant_id?: number;
  addons: CartAddon[];
  modifiers: CartModifier[];
  notes?: string;
};

const ITEM_PLACEHOLDER = (label: string) => {
  const safe = (label || "Food").replace(/[<>&"]/g, "");

  // Split into up to 2 lines so long names don't get cut.
  const words = safe.split(/\s+/).filter(Boolean);
  let line1 = "";
  let line2 = "";
  if (words.length <= 1) {
    const text = safe;
    if (text.length <= 14) {
      line1 = text;
    } else if (text.length <= 22) {
      line1 = text.slice(0, 14);
      line2 = text.slice(14, 22);
    } else {
      line1 = text.slice(0, 16);
      line2 = text.slice(16, 32);
    }
  } else {
    const mid = Math.ceil(words.length / 2);
    line1 = words.slice(0, mid).join(" ");
    line2 = words.slice(mid).join(" ");
  }

  const maxLen = Math.max(line1.length, line2.length);
  const fontSize = maxLen > 22 ? 52 : maxLen > 16 ? 62 : 72;
  const lineHeight = Math.round(fontSize * 1.1);
  const y1 = 410;
  const y2 = y1 + lineHeight;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="750" viewBox="0 0 1200 750">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#dc2626" stop-opacity="0.22" />
      <stop offset="0.55" stop-color="#0f172a" stop-opacity="0.9" />
      <stop offset="1" stop-color="#000000" stop-opacity="1" />
    </linearGradient>
  </defs>
  <rect width="1200" height="750" fill="url(#g)"/>
  <g opacity="0.6">
    <circle cx="220" cy="220" r="160" fill="#dc2626"/>
    <circle cx="980" cy="520" r="220" fill="#dc2626"/>
  </g>
  <text
    x="600"
    y="${y1}"
    text-anchor="middle"
    font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto"
    font-size="${fontSize}"
    font-weight="900"
    fill="#f4f4f5"
    letter-spacing="1"
  >
    ${line1}
  </text>
  ${
    line2
      ? `<text x="600" y="${y2}" text-anchor="middle" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto" font-size="${fontSize}" font-weight="900" fill="#f4f4f5" letter-spacing="1">${line2}</text>`
      : ""
  }
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

export function ItemConfigModal({
  item,
  open,
  onClose,
  onConfirm,
  initialValue,
}: {
  item: MenuItem | null;
  open: boolean;
  onClose: () => void;
  onConfirm: (value: ConfigValue) => void;
  initialValue?: Partial<ConfigValue>;
}) {
  // Keep hook order stable even when `item` is null (parent passes null while closed).
  const itemResolved = (item ?? ({} as MenuItem)) as MenuItem;

  const defaultVariantId = item?.variants?.find((v) => v.is_default === true || v.isDefault === true)?.id;
  const initialSection: "variant" | "modifiers" | "addons" | "notes" = item?.variants?.length
    ? "variant"
    : item?.modifier_groups?.length
      ? "modifiers"
      : item?.addons?.length
        ? "addons"
        : "notes";

  const [quantity, setQuantity] = useState<number>(Math.max(1, initialValue?.quantity ?? 1));
  const [variantId, setVariantId] = useState<number | undefined>(
    initialValue?.variant_id ?? defaultVariantId,
  );
  const [notes, setNotes] = useState<string>(initialValue?.notes ?? "");
  const [addons, setAddons] = useState<CartAddon[]>(initialValue?.addons ?? []);
  const [modifiers, setModifiers] = useState<CartModifier[]>(initialValue?.modifiers ?? []);
  const [openSection, setOpenSection] = useState<"variant" | "modifiers" | "addons" | "notes">(
    initialSection,
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  const addonMap = useMemo(() => new Map(addons.map((a) => [a.addon_id, a])), [addons]);
  const modMap = useMemo(
    () => new Map(modifiers.map((m) => [m.modifier_id, m])),
    [modifiers],
  );

  const addonPriceById = useMemo(() => {
    const m = new Map<number, number>();
    (itemResolved.addons ?? []).forEach((a) => m.set(a.id, a.price));
    return m;
  }, [itemResolved.addons]);

  const selectedVariant = useMemo(
    () => (itemResolved.variants ?? []).find((v) => v.id === variantId) ?? null,
    [itemResolved.variants, variantId],
  );

  const heatModifierGroups = useMemo(
    () => (itemResolved.modifier_groups ?? []).filter((g) => g.max_select === 1),
    [itemResolved.modifier_groups],
  );

  const signatureModifierGroups = useMemo(
    () => (itemResolved.modifier_groups ?? []).filter((g) => g.max_select !== 1),
    [itemResolved.modifier_groups],
  );

  const stepKeys = useMemo(() => {
    const steps: Array<"variant" | "heat" | "signature" | "addons" | "notes"> = [];
    if ((itemResolved.variants ?? []).length > 0) steps.push("variant");
    if (heatModifierGroups.length > 0) steps.push("heat");
    if (signatureModifierGroups.length > 0) steps.push("signature");
    if ((itemResolved.addons ?? []).length > 0) steps.push("addons");
    steps.push("notes");
    return steps;
  }, [
    heatModifierGroups.length,
    itemResolved.addons,
    itemResolved.variants,
    signatureModifierGroups.length,
  ]);

  const getStepNum = (key: "variant" | "heat" | "signature" | "addons" | "notes") =>
    stepKeys.findIndex((s) => s === key) + 1;

  const sizeKey = useMemo(() => sizeKeyForVariant(selectedVariant), [selectedVariant]);
  // Hide options restricted to other sizes (e.g. Thin Crust on 7"). No size ⇒ show all.
  const isModAvailableForSize = (mod: { available_for_sizes?: string[] | null }) =>
    !mod.available_for_sizes?.length || !sizeKey || mod.available_for_sizes.includes(sizeKey);

  const perItemTotal = useMemo(() => {
    const variantExtra = selectedVariant?.price_modifier ?? 0;
    const modifiersExtra = computeModifiersPrice(
      itemResolved.modifier_groups,
      modifiers,
      sizeKey,
    );
    const addonsExtra = addons.reduce((sum, a) => {
      const unit = addonPriceById.get(a.addon_id) ?? 0;
      const qty = Math.max(1, Math.floor(a.quantity ?? 1));
      return sum + unit * qty;
    }, 0);
    return (itemResolved.price ?? 0) + variantExtra + modifiersExtra + addonsExtra;
  }, [
    addonPriceById,
    addons,
    itemResolved.price,
    itemResolved.modifier_groups,
    modifiers,
    selectedVariant,
    sizeKey,
  ]);

  const setAddonQuantity = (addonId: number, nextQty: number) => {
    setValidationError(null);
    const qty = Math.max(0, Math.floor(nextQty));
    setAddons((prev) => {
      if (qty === 0) return prev.filter((a) => a.addon_id !== addonId);
      const existing = prev.find((a) => a.addon_id === addonId);
      if (!existing) return [...prev, { addon_id: addonId, quantity: qty }];
      return prev.map((a) => (a.addon_id === addonId ? { ...a, quantity: qty } : a));
    });
  };

  const changeModifier = (modId: number, checked: boolean) => {
    setValidationError(null);
    const group = (itemResolved.modifier_groups ?? []).find((g) =>
      (g.modifiers ?? []).some((m) => m.id === modId),
    );
    if (!group) return;
    const groupSelected = modifiers.filter((selected) =>
      (group.modifiers ?? []).some((m) => m.id === selected.modifier_id),
    );

    // max_select bounds TOTAL units in the group (so the same option chosen twice fills
    // a "choose 2" group), not the count of distinct options.
    const unitsInGroup = groupSelected.reduce((s, m) => s + (m.quantity ?? 1), 0);

    if (checked) {
      if (modMap.has(modId)) return;
      if (group.max_select === 1) {
        setModifiers((prev) => [
          ...prev.filter(
            (selected) => !(group.modifiers ?? []).some((m) => m.id === selected.modifier_id),
          ),
          { modifier_id: modId, quantity: 1 },
        ]);
        return;
      }
      if ((group.max_select ?? 99) <= unitsInGroup) {
        setValidationError(
          `You can select at most ${group.max_select} for "${group.name}".`,
        );
        return;
      }
      setModifiers((prev) => [...prev, { modifier_id: modId, quantity: 1 }]);
      return;
    }
    setModifiers((prev) => prev.filter((m) => m.modifier_id !== modId));
  };

  // Adjust how many of the same modifier are selected ("double X"). 0 removes it.
  // Clamped so the group's total units never exceed max_select.
  const setModifierQuantity = (modId: number, nextQty: number) => {
    setValidationError(null);
    let qty = Math.max(0, Math.floor(nextQty));
    const group = (itemResolved.modifier_groups ?? []).find((g) =>
      (g.modifiers ?? []).some((m) => m.id === modId),
    );
    if (group && qty > 0) {
      const max = group.max_select ?? 99;
      const otherUnits = modifiers
        .filter((m) => m.modifier_id !== modId && (group.modifiers ?? []).some((mod) => mod.id === m.modifier_id))
        .reduce((s, m) => s + (m.quantity ?? 1), 0);
      qty = Math.min(qty, Math.max(0, max - otherUnits));
    }
    setModifiers((prev) =>
      prev
        .map((m) => (m.modifier_id === modId ? { ...m, quantity: qty } : m))
        .filter((m) => (m.quantity ?? 1) > 0),
    );
  };

  if (!item) return null;

  const onSubmit = () => {
    setValidationError(null);
    const normalizedQuantity = Number.isFinite(quantity) ? Math.max(1, Math.floor(quantity)) : 1;
    const validVariantIds = new Set((itemResolved.variants ?? []).map((variant) => variant.id));
    const validAddonIds = new Set((itemResolved.addons ?? []).map((addon) => addon.id));
    const validModifierIds = new Set(
      (itemResolved.modifier_groups ?? []).flatMap((group) => (group.modifiers ?? []).map((mod) => mod.id)),
    );

    if ((itemResolved.variants ?? []).length > 0 && !variantId) {
      setOpenSection("variant");
      setValidationError("Please select a variant.");
      return;
    }
    if (variantId && !validVariantIds.has(variantId)) {
      setOpenSection("variant");
      setValidationError("Selected variant is not valid for this item.");
      return;
    }

    const cleanAddons = addons
      .filter((a, idx, arr) => validAddonIds.has(a.addon_id) && arr.findIndex((x) => x.addon_id === a.addon_id) === idx)
      .map((a) => ({ addon_id: a.addon_id, quantity: Math.max(1, Math.floor(a.quantity ?? 1)) }));
    const cleanModifiers = modifiers
      .filter(
        (m, idx, arr) =>
          validModifierIds.has(m.modifier_id) &&
          arr.findIndex((x) => x.modifier_id === m.modifier_id) === idx,
      )
      .map((m) => ({
        modifier_id: m.modifier_id,
        quantity: Math.max(1, Math.floor(m.quantity ?? 1)),
      }));

    for (const group of itemResolved.modifier_groups ?? []) {
      const selectedInGroup = cleanModifiers.filter((selected) =>
        (group.modifiers ?? []).some((mod) => mod.id === selected.modifier_id),
      );
      const count = selectedInGroup.length;
      if ((group.min_select ?? 0) > count) {
        setOpenSection("modifiers");
        setValidationError(`Please select at least ${group.min_select} for "${group.name}".`);
        return;
      }
      if (group.max_select != null && count > group.max_select) {
        setOpenSection("modifiers");
        setValidationError(`Please select at most ${group.max_select} for "${group.name}".`);
        return;
      }
    }

    onConfirm({
      quantity: normalizedQuantity,
      variant_id: variantId,
      addons: cleanAddons,
      modifiers: cleanModifiers,
      notes: notes.trim() || undefined,
    });
  };

  const canSubmit = (itemResolved.variants ?? []).length === 0 || Boolean(variantId);
  const variantRequired = (itemResolved.variants ?? []).length > 0;

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            initial={{ y: 24, opacity: 0, scale: 0.99 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 24, opacity: 0, scale: 0.99 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-6xl"
          >
            <Card className="overflow-hidden">
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_520px]">
                {/* Left: image */}
                <div className="relative bg-[var(--surface-2)] lg:min-h-[420px]">
                  <div className="absolute inset-0 p-3 sm:p-6">
                    {item.image_url ? (
                      <Image
                        src={toImageUrl(item.image_url)}
                        alt={item.name}
                        fill
                        unoptimized
                        className="object-contain opacity-95"
                      />
                    ) : (
                      <Image
                        src={ITEM_PLACEHOLDER(item.name)}
                        alt={item.name}
                        fill
                        unoptimized
                        className="object-contain opacity-95"
                      />
                    )}
                  </div>
                  <div className="absolute inset-0 foodies-media-overlay" />
                  <div className="absolute left-5 top-5 rounded-full border border-white/10 bg-black/40 px-4 py-2 text-xs font-bold uppercase tracking-[0.22em] text-white/70">
                    Product Detail
                  </div>
                </div>

                {/* Right: steps */}
                <div className="relative flex max-h-[88vh] flex-col overflow-hidden">
                  <div className="flex-1 overflow-y-auto p-5 sm:p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-2xl font-black leading-tight text-white">{item.name}</h3>
                        <p className="mt-2 text-sm text-[var(--muted)]">
                          {item.description || "No description."}
                        </p>
                      </div>

                      <div className="flex flex-col items-end">
                        <div className="rounded-full bg-red-600 px-4 py-2 text-sm font-extrabold text-white shadow-[0_0_0_1px_rgba(0,0,0,0.2)]">
                          Rs. {perItemTotal.toFixed(2)}
                        </div>
                        <div className="mt-2 text-xs text-white/60">
                          {variantRequired && !variantId ? (
                            <span className="text-red-300">Variant required</span>
                          ) : (
                            "Ready to customize"
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 flex items-center justify-between gap-4 rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-2)] p-4">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.22em] text-white/60">
                          Quantity
                        </p>
                        <p className="mt-2 text-sm text-white/80">
                          Total: Rs. {(perItemTotal * Math.max(1, quantity)).toFixed(2)}
                        </p>
                      </div>
                      <Input
                        type="number"
                        min={1}
                        value={quantity}
                        onChange={(e) => setQuantity(Number(e.target.value))}
                        className="w-[120px]"
                      />
                    </div>

                    {/* Step 1: Variants */}
                    {(item.variants ?? []).length > 0 ? (
                      <div
                        className={`mt-5 rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-2)] p-4 ${
                          openSection === "variant" && validationError ? "ring-1 ring-red-500/60" : ""
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs font-bold uppercase tracking-[0.22em] text-white/60">
                    Step {getStepNum("variant")}: Variants{" "}
                    {variantId ? null : <span className="ml-2 text-red-300">(required)</span>}
                          </p>
                        </div>

                        <div className="mt-4 grid gap-3 sm:grid-cols-3">
                          {(item.variants ?? []).map((v) => {
                            const active = variantId === v.id;
                            const mod = v.price_modifier;
                            return (
                              <button
                                key={v.id}
                                type="button"
                                onClick={() => {
                                  setValidationError(null);
                                  setVariantId(v.id);
                                }}
                                className={`relative overflow-hidden rounded-xl border px-4 py-3 text-left transition ${
                                  active
                                    ? "border-red-500/70 bg-red-500/10"
                                    : "border-[var(--border-soft)] bg-black/20 hover:bg-black/30"
                                }`}
                              >
                                <div className="text-sm font-extrabold text-white">{v.name}</div>
                                <div className={`mt-1 text-xs font-semibold ${mod >= 0 ? "text-emerald-300" : "text-amber-300"}`}>
                                  {mod >= 0 ? "+" : "-"}Rs. {Math.abs(mod).toFixed(2)}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    {/* Step 2: Modifiers */}
                    {heatModifierGroups.length > 0 ? (
                      <div
                        className={`mt-5 rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-2)] p-4 ${
                          openSection === "modifiers" && validationError ? "ring-1 ring-red-500/60" : ""
                        }`}
                      >
                          <p className="text-xs font-bold uppercase tracking-[0.22em] text-white/60">
                          Step {getStepNum("heat")}: Heat Level
                        </p>

                        <div className="mt-4 space-y-4">
                          {heatModifierGroups.map((group) => {
                            const selectedInGroup = modifiers.filter((selected) =>
                              (group.modifiers ?? []).some((m) => m.id === selected.modifier_id),
                            );
                            const required = (group.min_select ?? 0) > 0;
                            return (
                              <div key={group.id}>
                                <div className="flex items-center justify-between gap-3">
                                  <p className="text-sm font-bold text-white/90">
                                    {group.name}{" "}
                                    {required ? (
                                      <span className="ml-2 text-xs font-bold text-red-300">(required)</span>
                                    ) : (
                                      <span className="ml-2 text-xs font-bold text-white/50">(optional)</span>
                                    )}
                                  </p>
                                  <p className="text-xs text-white/55">
                                    Selected: {selectedInGroup.length}
                                  </p>
                                </div>

                                <div className={`mt-3 grid gap-2 ${group.max_select === 1 ? "grid-cols-3" : "grid-cols-2"}`}>
                                  {(group.modifiers ?? []).filter(isModAvailableForSize).map((mod) => {
                                    const active = modMap.has(mod.id);
                                    const unitPrice = resolveModifierUnitPrice(mod, sizeKey);
                                    return (
                                      <button
                                        key={mod.id}
                                        type="button"
                                        onClick={() => changeModifier(mod.id, !active)}
                                        className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left transition ${
                                          active
                                            ? "border-red-500/70 bg-red-500/10"
                                            : "border-[var(--border-soft)] bg-black/20 hover:bg-black/30"
                                        }`}
                                      >
                                        <span className="text-xs font-semibold text-white/90">
                                          {mod.name}
                                        </span>
                                        {unitPrice > 0 ? (
                                          <span className="ml-2 text-[11px] font-extrabold text-emerald-300">
                                            +Rs. {unitPrice.toFixed(2)}
                                          </span>
                                        ) : null}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    {/* Step 3: Signature */}
                    {signatureModifierGroups.length > 0 ? (
                      <div
                        className={`mt-5 rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-2)] p-4 ${
                          openSection === "modifiers" && validationError ? "ring-1 ring-red-500/60" : ""
                        }`}
                      >
                        <p className="text-xs font-bold uppercase tracking-[0.22em] text-white/60">
                          Step {getStepNum("signature")}: Signature
                        </p>

                        <div className="mt-4 space-y-4">
                          {signatureModifierGroups.map((group) => {
                            const selectedInGroup = modifiers.filter((selected) =>
                              (group.modifiers ?? []).some((m) => m.id === selected.modifier_id),
                            );
                            const required = (group.min_select ?? 0) > 0;
                            // "First N free" allowance, allocated to the cheapest selected units first.
                            const includedFree =
                              sizeKey && group.included_by_size && group.included_by_size[sizeKey] != null
                                ? Number(group.included_by_size[sizeKey])
                                : group.included_quantity ?? 0;
                            const priceOfMod = (id: number) => {
                              const m = (group.modifiers ?? []).find((mm) => mm.id === id);
                              return m ? resolveModifierUnitPrice(m, sizeKey) : 0;
                            };
                            const freeUnitsByMod = new Map<number, number>();
                            let freeRemaining = includedFree;
                            for (const sel of [...selectedInGroup].sort((a, b) => priceOfMod(a.modifier_id) - priceOfMod(b.modifier_id))) {
                              const q = Math.max(1, Math.floor(sel.quantity ?? 1));
                              const f = Math.max(0, Math.min(freeRemaining, q));
                              freeUnitsByMod.set(sel.modifier_id, f);
                              freeRemaining -= f;
                            }
                            return (
                              <div key={group.id}>
                                <div className="flex items-center justify-between gap-3">
                                  <p className="text-sm font-bold text-white/90">
                                    {group.name}{" "}
                                    {required ? (
                                      <span className="ml-2 text-xs font-bold text-red-300">(required)</span>
                                    ) : (
                                      <span className="ml-2 text-xs font-bold text-white/50">(optional)</span>
                                    )}
                                  </p>
                                  <p className="text-xs text-white/55">
                                    Selected: {selectedInGroup.length}
                                  </p>
                                </div>
                                {includedFree > 0 ? (
                                  <p className="mt-1 text-[11px] font-semibold text-emerald-300">
                                    First {includedFree} free — extras charged at the price shown.
                                  </p>
                                ) : null}

                                <div
                                  className={`mt-3 grid gap-2 ${
                                    (group.max_select ?? 99) > 1 ? "grid-cols-2" : "grid-cols-3"
                                  }`}
                                >
                                  {(group.modifiers ?? []).filter(isModAvailableForSize).map((mod) => {
                                    const current = modMap.get(mod.id);
                                    const active = !!current;
                                    const unitPrice = resolveModifierUnitPrice(mod, sizeKey);
                                    const modQty = Math.max(1, Math.floor(current?.quantity ?? 1));
                                    // Quantity stepper only where repeating is meaningful (priced,
                                    // free-allowance, or a "choose N" group) — not free toggles
                                    // like "Remove a filling" / "Add a Sauce".
                                    const canRepeat =
                                      active &&
                                      (unitPrice > 0 || includedFree > 0 || (group.min_select ?? 0) > 0 || !!group.allow_quantity);
                                    return (
                                      <div
                                        key={mod.id}
                                        className={`flex flex-col gap-1 rounded-lg border px-3 py-2 transition ${
                                          active
                                            ? "border-red-500/70 bg-red-500/10"
                                            : "border-[var(--border-soft)] bg-black/20 hover:bg-black/30"
                                        }`}
                                      >
                                        <button
                                          type="button"
                                          onClick={() => changeModifier(mod.id, !active)}
                                          className="flex items-center justify-between text-left"
                                        >
                                          <span className="text-xs font-semibold text-white/90">{mod.name}</span>
                                          {(() => {
                                            if (unitPrice <= 0) return null;
                                            const freeUnits = freeUnitsByMod.get(mod.id) ?? 0;
                                            if (active) {
                                              const charged = modQty - freeUnits;
                                              return charged <= 0 ? (
                                                <span className="ml-2 text-[11px] font-extrabold text-emerald-300">Included</span>
                                              ) : (
                                                <span className="ml-2 text-[11px] font-extrabold text-emerald-300">+Rs. {(unitPrice * charged).toFixed(2)}</span>
                                              );
                                            }
                                            return freeRemaining > 0 ? (
                                              <span className="ml-2 text-[11px] font-extrabold text-emerald-300">Free</span>
                                            ) : (
                                              <span className="ml-2 text-[11px] font-extrabold text-emerald-300">+Rs. {unitPrice.toFixed(2)}</span>
                                            );
                                          })()}
                                        </button>
                                        {canRepeat ? (
                                          <div className="flex items-center justify-end gap-2">
                                            <button
                                              type="button"
                                              aria-label="Decrease quantity"
                                              onClick={() => setModifierQuantity(mod.id, modQty - 1)}
                                              className="h-6 w-6 rounded-full border border-[var(--border-soft)] text-sm font-bold text-white/80 hover:bg-black/30"
                                            >
                                              −
                                            </button>
                                            <span className="min-w-[1.25rem] text-center text-xs font-bold tabular-nums text-white/90">
                                              {modQty}
                                            </span>
                                            <button
                                              type="button"
                                              aria-label="Increase quantity"
                                              onClick={() => setModifierQuantity(mod.id, modQty + 1)}
                                              className="h-6 w-6 rounded-full border border-[var(--border-soft)] text-sm font-bold text-white/80 hover:bg-black/30"
                                            >
                                              +
                                            </button>
                                          </div>
                                        ) : null}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    {/* Step 4: Add-ons */}
                    {(item.addons ?? []).length > 0 ? (
                      <div
                        className={`mt-5 rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-2)] p-4 ${
                          openSection === "addons" && validationError ? "ring-1 ring-red-500/60" : ""
                        }`}
                      >
                        <p className="text-xs font-bold uppercase tracking-[0.22em] text-white/60">
                          Step {getStepNum("addons")}: Add-ons
                        </p>

                        <div className="mt-4 space-y-3">
                          {(item.addons ?? []).map((a) => {
                            const current = addonMap.get(a.id);
                            const qty = Math.max(0, Math.floor(current?.quantity ?? 0));
                            return (
                              <div
                                key={a.id}
                                className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-soft)] bg-black/10 px-4 py-3"
                              >
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold text-white/90">{a.name}</p>
                                  <p className="mt-1 text-xs font-semibold text-emerald-300">
                                    +Rs. {a.price.toFixed(2)} each
                                  </p>
                                </div>

                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setAddonQuantity(a.id, qty - 1)}
                                    className="h-9 w-9 rounded-lg border border-white/10 bg-black/30 text-lg font-black text-white/90 transition hover:bg-black/50"
                                  >
                                    -
                                  </button>
                                  <div className="h-9 min-w-[40px] rounded-lg border border-white/10 bg-black/20 text-center leading-9 text-sm font-extrabold text-white">
                                    {qty}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setAddonQuantity(a.id, qty + 1)}
                                    className="h-9 w-9 rounded-lg border border-white/10 bg-black/30 text-lg font-black text-white/90 transition hover:bg-black/50"
                                  >
                                    +
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    {/* Step 5: Notes */}
                    <div
                      className={`mt-5 rounded-2xl border border-[var(--border-soft)] bg-[var(--surface-2)] p-4 ${
                        openSection === "notes" && validationError ? "ring-1 ring-red-500/60" : ""
                      }`}
                    >
                      <p className="text-xs font-bold uppercase tracking-[0.22em] text-white/60">
                        Step {getStepNum("notes")}: Special Instructions (Optional)
                      </p>
                      <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        rows={4}
                        className="mt-3 w-full resize-none rounded-xl border border-[var(--border-soft)] bg-black/20 px-3 py-2 text-sm text-white/90 outline-none ring-red-500/40 placeholder:text-white/30 focus:ring-2"
                        placeholder="Add any special instructions..."
                      />
                    </div>

                    {validationError ? (
                      <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                        {validationError}
                      </div>
                    ) : null}
                  </div>

                  {/* Sticky footer actions */}
                  <div className="border-t border-white/10 bg-[var(--surface-2)] p-4">
                    <div className="flex justify-end gap-3">
                      <Button variant="secondary" onClick={onClose} className="min-w-[120px]">
                        Cancel
                      </Button>
                      <Button
                        onClick={onSubmit}
                        disabled={!canSubmit}
                        className="min-w-[160px]"
                      >
                        Add to cart
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

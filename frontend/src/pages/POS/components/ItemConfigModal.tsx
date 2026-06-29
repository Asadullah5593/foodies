import React, { useMemo, useState, useEffect } from 'react';
import { MdAdd, MdRemove, MdCheckCircle } from 'react-icons/md';
import { motion, AnimatePresence } from 'framer-motion';
import { formatCurrency } from '../../../utils/currency';
import { MenuItem } from '../../../types';
import { ItemConfig } from './types';
import {
  resolveModifierUnitPrice,
  sizeKeyForSelection,
  computeModifiersPrice,
} from '../../../utils/modifierPricing';

function formatTiers(tiers: Record<string, number>): string {
  return Object.keys(tiers)
    .map(Number)
    .filter((k) => Number.isFinite(k))
    .sort((a, b) => a - b)
    .map((k) => `${k}: ${formatCurrency(tiers[String(k)])}`)
    .join(', ');
}

type StepDef =
  | { kind: 'variant' }
  | { kind: 'modifier-group'; groupIndex: number }
  | { kind: 'addons' }
  | { kind: 'notes' };

export type ItemConfigModalProps = {
  isOpen: boolean;
  onClose: () => void;
  item: MenuItem | null;
  config: ItemConfig;
  onConfigChange: (config: ItemConfig) => void;
  onConfirm: () => void;
  onToggleAddon: (addonId: number) => void;
  onToggleModifier: (modifierId: number) => void;
  onUpdateAddonQuantity: (addonId: number, quantity: number) => void;
  /** Optional: lets the same modifier be selected multiple times ("double meat"). */
  onUpdateModifierQuantity?: (modifierId: number, quantity: number) => void;
};

const ItemConfigModal: React.FC<ItemConfigModalProps> = ({
  isOpen,
  onClose,
  item,
  config,
  onConfigChange,
  onConfirm,
  onToggleAddon,
  onToggleModifier,
  onUpdateAddonQuantity,
  onUpdateModifierQuantity,
}) => {
  const [step, setStep] = useState(0);

  useEffect(() => { setStep(0); }, [isOpen, item?.id]);

  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : 'unset';
    return () => { document.body.style.overflow = 'unset'; };
  }, [isOpen]);

  const sizeKey = item ? sizeKeyForSelection(item, config.variantId) : null;

  const isModAvailableForSize = (
    mod: { available_for_sizes?: string[] | null },
    sk: string | null,
  ) => !mod.available_for_sizes?.length || !sk || mod.available_for_sizes.includes(sk);

  const steps = useMemo((): StepDef[] => {
    if (!item) return [];
    const s: StepDef[] = [];
    if (item.variants?.length) s.push({ kind: 'variant' });
    (item.modifier_groups ?? []).forEach((_, i) =>
      s.push({ kind: 'modifier-group', groupIndex: i }),
    );
    if (item.addons?.length) s.push({ kind: 'addons' });
    s.push({ kind: 'notes' });
    return s;
  }, [item]);

  const stepLabel = (s: StepDef): string => {
    switch (s.kind) {
      case 'variant': return 'Size';
      case 'modifier-group': return item?.modifier_groups?.[s.groupIndex]?.name ?? 'Options';
      case 'addons': return 'Add-ons';
      case 'notes': return 'Notes';
    }
  };

  const isStepRequired = (s: StepDef): boolean => {
    switch (s.kind) {
      case 'variant': return true;
      case 'modifier-group': return (item?.modifier_groups?.[s.groupIndex]?.min_select ?? 0) > 0;
      default: return false;
    }
  };

  const isStepComplete = (s: StepDef): boolean => {
    switch (s.kind) {
      case 'variant': return config.variantId != null;
      case 'modifier-group': {
        const g = item?.modifier_groups?.[s.groupIndex];
        if (!g) return true;
        const min = g.min_select ?? 0;
        if (min === 0) return true;
        const units = (config.modifiers ?? [])
          .filter((m) => g.modifiers.some((mod) => mod.id === m.modifierId))
          .reduce((sum, m) => sum + (m.quantity || 1), 0);
        return units >= min;
      }
      default: return true;
    }
  };

  const currentStepDef = steps[step];
  const isFirst = step === 0;
  const isLast = step === steps.length - 1;
  const canAdvance = !currentStepDef || !isStepRequired(currentStepDef) || isStepComplete(currentStepDef);
  const anyRequiredIncomplete = steps.some((s) => isStepRequired(s) && !isStepComplete(s));

  const runningTotal = useMemo(() => {
    if (!item) return 0;
    const base = item.price ?? item.base_price ?? 0;
    const variantMod = config.variantId && item.variants
      ? (item.variants.find((v) => v.id === config.variantId)?.price_modifier ?? 0)
      : 0;
    const addonsPrice = (config.addons ?? []).reduce((sum, a) => {
      const addon = item.addons?.find((ad) => ad.id === a.addonId);
      return sum + (addon?.price ?? 0) * a.quantity;
    }, 0);
    const modPrice = computeModifiersPrice(item.modifier_groups, config.modifiers, sizeKey);
    return base + variantMod + addonsPrice + modPrice;
  }, [item, config, sizeKey]);

  // ─── Step content ──────────────────────────────────────────────────────────
  const renderStepContent = () => {
    if (!item || !currentStepDef) return null;

    // ── Variant ──
    if (currentStepDef.kind === 'variant') {
      return (
        <div className="grid grid-cols-1 gap-4">
          {item.variants!.map((variant) => {
            const selected = config.variantId === variant.id;
            return (
              <label
                key={variant.id}
                className={`flex items-center gap-5 p-5 rounded-xl border-2 cursor-pointer transition-all ${
                  selected
                    ? 'border-red-500 bg-red-50 shadow-sm'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  name="variant"
                  checked={selected}
                  onChange={() => {
                    const newSize = variant.size_key ?? null;
                    const modifiers = (config.modifiers ?? []).filter((m) => {
                      const md = item.modifier_groups?.flatMap((g) => g.modifiers).find((x) => x.id === m.modifierId);
                      return !md || isModAvailableForSize(md, newSize);
                    });
                    onConfigChange({ ...config, variantId: variant.id, modifiers });
                  }}
                  className="sr-only"
                />
                {/* Custom radio dot */}
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-none transition-colors ${
                  selected ? 'border-red-500 bg-red-500' : 'border-gray-300'
                }`}>
                  {selected && <div className="w-2 h-2 rounded-full bg-white" />}
                </div>
                <span className="flex-1 text-base font-semibold text-gray-800">{variant.name}</span>
                <span className={`text-base font-bold ${selected ? 'text-red-600' : 'text-gray-700'}`}>
                  {formatCurrency((item.price ?? item.base_price ?? 0) + variant.price_modifier)}
                </span>
                {selected && <MdCheckCircle className="h-5 w-5 text-red-500 flex-none" />}
              </label>
            );
          })}
        </div>
      );
    }

    // ── Modifier group ──
    if (currentStepDef.kind === 'modifier-group') {
      const group = item.modifier_groups![currentStepDef.groupIndex];
      const selectedInGroup = (config.modifiers ?? []).filter((m) =>
        group.modifiers.some((mod) => mod.id === m.modifierId),
      );
      const visibleModifiers = group.modifiers.filter((mod) => isModAvailableForSize(mod, sizeKey));
      const unitsInGroup = selectedInGroup.reduce((s, m) => s + (m.quantity || 1), 0);
      const minSelect = group.min_select ?? 0;
      const maxUnits = group.max_select ?? 99;
      const minOk = unitsInGroup >= minSelect;
      const atMax = unitsInGroup >= maxUnits;
      const isSingleSelect = (group.max_select ?? 0) === 1;

      const includedFree =
        sizeKey && group.included_by_size && group.included_by_size[sizeKey] != null
          ? Number(group.included_by_size[sizeKey])
          : group.included_quantity ?? 0;

      const priceOfMod = (id: number) => {
        const m = group.modifiers.find((mm) => mm.id === id);
        return m ? resolveModifierUnitPrice(m, sizeKey) : 0;
      };
      const freeUnitsByMod = new Map<number, number>();
      let freeRemaining = includedFree;
      const sortedByPrice = [...selectedInGroup].sort(
        (a, b) => priceOfMod(a.modifierId) - priceOfMod(b.modifierId),
      );
      const maxQty = selectedInGroup.reduce((m, s) => Math.max(m, s.quantity || 1), 0);
      outer: for (let slot = 0; slot < maxQty; slot++) {
        for (const sel of sortedByPrice) {
          if (freeRemaining <= 0) break outer;
          if ((sel.quantity || 1) <= slot) continue;
          freeUnitsByMod.set(sel.modifierId, (freeUnitsByMod.get(sel.modifierId) ?? 0) + 1);
          freeRemaining--;
        }
      }

      return (
        <div>
          {/* Allowance / tier note */}
          {group.price_tiers && Object.keys(group.price_tiers).length > 0 ? (
            <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-emerald-50 rounded-lg border border-emerald-100">
              <span className="text-emerald-600 text-sm font-medium">
                {includedFree > 0 ? `First ${includedFree} free. ` : ''}Extra: {formatTiers(group.price_tiers)}
              </span>
            </div>
          ) : includedFree > 0 ? (
            <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-emerald-50 rounded-lg border border-emerald-100">
              <span className="text-emerald-600 text-sm font-medium">
                First {includedFree} free — extras charged at the price shown.
              </span>
            </div>
          ) : null}

          {/* Validation hint */}
          {!minOk && minSelect > 0 && (
            <div className="mb-4 px-3 py-2 bg-amber-50 rounded-lg border border-amber-100">
              <span className="text-amber-700 text-sm font-medium">
                Select at least {minSelect} option{minSelect > 1 ? 's' : ''}
                {maxUnits < 99 ? ` (up to ${maxUnits})` : ''}
              </span>
            </div>
          )}

          {/* Selection counter badge */}
          {maxUnits < 99 && (
            <div className="flex justify-end mb-3">
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                atMax ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
              }`}>
                {unitsInGroup} / {maxUnits} selected
              </span>
            </div>
          )}

          <div className="space-y-3">
            {visibleModifiers.map((mod) => {
              const selected = (config.modifiers ?? []).find((m) => m.modifierId === mod.id);
              const isSelected = !!selected;
              const unitPrice = resolveModifierUnitPrice(mod, sizeKey);
              const canRepeat =
                isSelected &&
                !isSingleSelect &&
                !!onUpdateModifierQuantity &&
                (unitPrice > 0 || includedFree > 0 || minSelect > 0 || !!group.allow_quantity);

              const priceTag = (() => {
                if (unitPrice <= 0) return null;
                const qty = selected?.quantity || 1;
                const freeUnits = freeUnitsByMod.get(mod.id) ?? 0;
                if (isSelected) {
                  const charged = qty - freeUnits;
                  return charged <= 0
                    ? { label: 'Included', cls: 'text-emerald-600 font-semibold' }
                    : { label: `+ ${formatCurrency(unitPrice * charged)}`, cls: 'text-gray-700 font-medium' };
                }
                return freeRemaining > 0
                  ? { label: 'Free', cls: 'text-emerald-600 font-semibold' }
                  : { label: `+ ${formatCurrency(unitPrice)}`, cls: 'text-gray-500' };
              })();

              return (
                <div
                  key={mod.id}
                  className={`flex items-center gap-4 px-5 py-4 rounded-xl border-2 transition-all ${
                    isSelected
                      ? 'border-red-400 bg-red-50 shadow-sm'
                      : atMax && !isSingleSelect
                      ? 'border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50 cursor-pointer'
                  }`}
                >
                  {/* Custom checkbox / radio */}
                  <button
                    type="button"
                    disabled={!isSelected && atMax && !isSingleSelect}
                    onClick={() => onToggleModifier(mod.id)}
                    className="flex-none focus:outline-none"
                    aria-label={isSelected ? `Deselect ${mod.name}` : `Select ${mod.name}`}
                  >
                    {isSingleSelect ? (
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                        isSelected ? 'border-red-500 bg-red-500' : 'border-gray-300'
                      }`}>
                        {isSelected && <div className="w-2 h-2 rounded-full bg-white" />}
                      </div>
                    ) : (
                      <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
                        isSelected ? 'border-red-500 bg-red-500' : 'border-gray-300'
                      }`}>
                        {isSelected && (
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                    )}
                  </button>

                  {/* Name — clicking whole row toggles */}
                  <span
                    className="flex-1 text-sm font-semibold text-gray-800 cursor-pointer select-none"
                    onClick={() => {
                      if (!isSelected && atMax && !isSingleSelect) return;
                      onToggleModifier(mod.id);
                    }}
                  >
                    {mod.name}
                  </span>

                  {/* Price tag */}
                  {priceTag && (
                    <span className={`text-sm flex-none ${priceTag.cls}`}>{priceTag.label}</span>
                  )}

                  {/* Qty stepper */}
                  {canRepeat && (
                    <div className="inline-flex items-center overflow-hidden rounded-lg border border-gray-300 flex-none">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onUpdateModifierQuantity!(mod.id, (selected?.quantity || 1) - 1); }}
                        aria-label="Decrease"
                        className="px-2 py-1.5 text-gray-600 hover:bg-gray-100 transition-colors"
                      >
                        <MdRemove className="h-4 w-4" />
                      </button>
                      <span className="min-w-[2.25rem] px-1 text-center text-sm font-bold tabular-nums">
                        {selected?.quantity || 1}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onUpdateModifierQuantity!(mod.id, (selected?.quantity || 1) + 1); }}
                        disabled={atMax}
                        aria-label="Increase"
                        className="px-2 py-1.5 text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        <MdAdd className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    // ── Add-ons ──
    if (currentStepDef.kind === 'addons') {
      return (
        <div className="grid grid-cols-1 gap-4">
          {item.addons!.map((addon) => {
            const isSelected = config.addons.some((a) => a.addonId === addon.id);
            const selectedAddon = config.addons.find((a) => a.addonId === addon.id);
            return (
              <div
                key={addon.id}
                className={`rounded-xl border-2 overflow-hidden transition-all ${
                  isSelected ? 'border-red-400 shadow-sm' : 'border-gray-200'
                }`}
              >
                <label className={`flex items-center gap-4 px-4 py-4 cursor-pointer ${isSelected ? 'bg-red-50' : 'hover:bg-gray-50'}`}>
                  {/* Custom checkbox */}
                  <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-none transition-colors ${
                    isSelected ? 'border-red-500 bg-red-500' : 'border-gray-300'
                  }`}>
                    {isSelected && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggleAddon(addon.id)}
                    className="sr-only"
                  />
                  <span className="flex-1 text-base font-semibold text-gray-800">{addon.name}</span>
                  <span className={`text-base font-bold ${isSelected ? 'text-red-600' : 'text-gray-600'}`}>
                    + {formatCurrency(addon.price)}
                  </span>
                </label>
                {isSelected && (
                  <div className="px-4 pb-3 pt-0 bg-red-50 flex items-center gap-3 border-t border-red-100">
                    <span className="text-sm text-gray-600 font-medium">Quantity</span>
                    <div className="inline-flex items-center overflow-hidden rounded-lg border border-gray-300 bg-white">
                      <button
                        type="button"
                        onClick={() => onUpdateAddonQuantity(addon.id, Math.max(1, (selectedAddon?.quantity || 1) - 1))}
                        disabled={(selectedAddon?.quantity || 1) <= 1}
                        aria-label="Decrease quantity"
                        className="px-2.5 py-1.5 text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        <MdRemove className="h-4 w-4" />
                      </button>
                      <span className="min-w-[2.5rem] px-2 py-1 text-center text-sm font-bold tabular-nums">
                        {selectedAddon?.quantity || 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => onUpdateAddonQuantity(addon.id, (selectedAddon?.quantity || 1) + 1)}
                        aria-label="Increase quantity"
                        className="px-2.5 py-1.5 text-gray-600 hover:bg-gray-100 transition-colors"
                      >
                        <MdAdd className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      );
    }

    // ── Special instructions ──
    if (currentStepDef.kind === 'notes') {
      return (
        <div>
          <p className="text-sm text-gray-500 mb-4">
            Let the kitchen know about dietary requirements, allergies, or personal preferences.
          </p>
          <textarea
            value={config.notes || ''}
            onChange={(e) => onConfigChange({ ...config, notes: e.target.value })}
            rows={6}
            placeholder="e.g., No onions, extra spicy, allergy to nuts…"
            className="w-full px-4 py-3.5 border-2 border-gray-200 rounded-xl focus:ring-0 focus:border-red-400 text-sm resize-none transition-colors placeholder:text-gray-400"
          />
        </div>
      );
    }

    return null;
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <AnimatePresence>
      {isOpen && item && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Dialog */}
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
              {/* ── Red accent stripe ── */}
              <div className="h-1.5 bg-gradient-to-r from-red-500 via-red-600 to-rose-500 flex-none" />

              {/* ── Header ── */}
              <div className="flex-none px-8 pt-6 pb-5 border-b border-gray-100">
                {/* Top row: item info + close */}
                <div className="flex items-start gap-4 mb-5">
                  {/* Item thumbnail */}
                  {item.image_url ? (
                    <img
                      src={item.image_url}
                      alt={item.name}
                      className="w-16 h-16 rounded-xl object-cover flex-none shadow-sm"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-red-100 to-rose-100 flex items-center justify-center flex-none">
                      <span className="text-2xl font-black text-red-400 select-none">
                        {item.name.charAt(0)}
                      </span>
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="inline-flex items-center gap-1 text-[10px] font-extrabold text-red-600 tracking-[0.15em] uppercase bg-red-50 px-2 py-0.5 rounded-full">
                        Step {step + 1} / {steps.length}
                      </span>
                    </div>
                    <h2 className="text-xl font-bold text-gray-900 truncate leading-tight">
                      {item.name}
                    </h2>
                    {item.description && (
                      <p className="text-sm text-gray-500 mt-0.5 line-clamp-1">{item.description}</p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={onClose}
                    className="flex-none text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors rounded-full p-2 -mr-1 -mt-1"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Progress bar */}
                <div className="space-y-2">
                  <div className="flex gap-1.5">
                    {steps.map((s, i) => (
                      <button
                        key={i}
                        type="button"
                        disabled={i >= step}
                        aria-label={`Go to ${stepLabel(s)}`}
                        className={`h-2.5 flex-1 rounded-full transition-all ${
                          i < step
                            ? 'bg-emerald-400 cursor-pointer hover:bg-emerald-500'
                            : i === step
                            ? 'bg-red-500 cursor-default'
                            : 'bg-gray-150 bg-gray-200 cursor-default'
                        }`}
                        onClick={() => { if (i < step) setStep(i); }}
                      />
                    ))}
                  </div>
                  <div className="flex gap-1.5">
                    {steps.map((s, i) => (
                      <div key={i} className="flex-1 min-w-0">
                        <span
                          className={`text-[10px] leading-none block truncate text-center font-medium ${
                            i === step ? 'text-red-600' : i < step ? 'text-emerald-600' : 'text-gray-400'
                          }`}
                        >
                          {stepLabel(s)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── Step title row ── */}
              <div className="flex-none px-8 py-5 flex items-center justify-between gap-3 bg-gray-50 border-b border-gray-100">
                <div className="min-w-0">
                  <h3 className="text-lg font-bold text-gray-900 truncate">
                    {currentStepDef ? stepLabel(currentStepDef) : ''}
                    {currentStepDef?.kind === 'modifier-group' && (() => {
                      const g = item.modifier_groups![currentStepDef.groupIndex];
                      const min = g.min_select ?? 0;
                      const max = g.max_select ?? 0;
                      if (min || max) {
                        return (
                          <span className="ml-2 text-sm font-normal text-gray-500">
                            — choose {min}{max && max !== min ? `–${max}` : ''}
                          </span>
                        );
                      }
                      return null;
                    })()}
                  </h3>
                </div>
                {currentStepDef && (
                  <span className={`flex-none text-xs font-bold px-3 py-1 rounded-full ${
                    isStepRequired(currentStepDef)
                      ? 'bg-red-100 text-red-700'
                      : 'bg-gray-200 text-gray-500'
                  }`}>
                    {isStepRequired(currentStepDef) ? 'Required' : 'Optional'}
                  </span>
                )}
              </div>

              {/* ── Scrollable body ── */}
              <div className="flex-1 overflow-y-auto px-8 py-6 min-h-[300px]">
                {renderStepContent()}
              </div>

              {/* ── Footer ── */}
              <div className="flex-none border-t border-gray-200 bg-gray-50 px-8 py-5">
                <div className="flex items-center gap-4">
                  {/* Running total */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-500 font-medium uppercase tracking-wider leading-none mb-1">
                      Running Total
                    </p>
                    <p className="text-2xl font-black text-gray-900 leading-none tabular-nums">
                      {formatCurrency(runningTotal)}
                    </p>
                  </div>

                  {/* Cancel / Back */}
                  <button
                    type="button"
                    onClick={() => (isFirst ? onClose() : setStep((s) => s - 1))}
                    className="px-5 py-2.5 text-sm font-semibold text-gray-700 bg-white border-2 border-gray-300 rounded-xl hover:border-gray-400 hover:bg-gray-50 transition-all"
                  >
                    {isFirst ? 'Cancel' : '← Back'}
                  </button>

                  {/* Next / Add to Order */}
                  {isLast ? (
                    <button
                      type="button"
                      onClick={onConfirm}
                      disabled={anyRequiredIncomplete}
                      className={`px-7 py-2.5 text-sm font-bold rounded-xl transition-all ${
                        anyRequiredIncomplete
                          ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                          : 'bg-red-600 text-white hover:bg-red-700 active:scale-95 shadow-md hover:shadow-lg shadow-red-200'
                      }`}
                    >
                      Add to Order
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setStep((s) => s + 1)}
                      disabled={!canAdvance}
                      className={`px-7 py-2.5 text-sm font-bold rounded-xl transition-all ${
                        !canAdvance
                          ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                          : 'bg-red-600 text-white hover:bg-red-700 active:scale-95 shadow-md hover:shadow-lg shadow-red-200'
                      }`}
                    >
                      Next →
                    </button>
                  )}
                </div>

                {!canAdvance && (
                  <p className="text-xs text-amber-600 font-medium mt-2.5 text-right">
                    Please make a selection to continue
                  </p>
                )}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
};

export default ItemConfigModal;

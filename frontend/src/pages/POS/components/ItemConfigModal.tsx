import React, { useMemo } from 'react';
import { MdAdd, MdRemove } from 'react-icons/md';
import Modal from '../../../components/Modal';
import Button from '../../../components/Button';
import { formatCurrency } from '../../../utils/currency';
import { MenuItem } from '../../../types';
import { ItemConfig } from './types';
import CollapsibleSection, { type SectionStatus } from './CollapsibleSection';
import { resolveModifierUnitPrice, sizeKeyForSelection } from '../../../utils/modifierPricing';

/** "1: Rs99, 2: Rs169, 3: Rs249" from a tier table (charged count → total). */
function formatTiers(tiers: Record<string, number>): string {
  return Object.keys(tiers)
    .map(Number)
    .filter((k) => Number.isFinite(k))
    .sort((a, b) => a - b)
    .map((k) => `${k}: ${formatCurrency(tiers[String(k)])}`)
    .join(', ');
}

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
  const sizeKey = item ? sizeKeyForSelection(item, config.variantId) : null;
  // An option restricted to certain sizes (e.g. Thin Crust on 10/12/14 only) is hidden
  // when a different size is chosen. No size selected yet ⇒ show all.
  const isModAvailableForSize = (
    mod: { available_for_sizes?: string[] | null },
    sk: string | null,
  ) => !mod.available_for_sizes?.length || !sk || mod.available_for_sizes.includes(sk);
  const variantStatus: SectionStatus | undefined = useMemo(() => {
    if (!item?.variants?.length) return undefined;
    return config.variantId != null ? 'complete' : 'required-missing';
  }, [item?.variants?.length, config.variantId]);

  const addonStatus: SectionStatus | undefined = useMemo(() => {
    if (!item?.addons?.length) return undefined;
    return (config.addons?.length ?? 0) > 0 ? 'complete' : 'optional-empty';
  }, [item?.addons?.length, config.addons?.length]);

  const modifierStatus: SectionStatus | undefined = useMemo(() => {
    if (!item?.modifier_groups?.length) return undefined;
    const anyRequiredMissing = item.modifier_groups.some((g) => {
      const min = g.min_select ?? 0;
      if (min === 0) return false;
      const count = (config.modifiers ?? []).filter((m) =>
        g.modifiers.some((mod) => mod.id === m.modifierId),
      ).length;
      return count < min;
    });
    return anyRequiredMissing ? 'required-missing' : 'complete';
  }, [item?.modifier_groups, config.modifiers]);

  const notesStatus: SectionStatus = useMemo(
    () => (config.notes?.trim() ? 'complete' : 'optional-empty'),
    [config.notes],
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={item?.name || 'Configure Item'}
      size="xlarge"
    >
      {item && (
        <div className="space-y-1">
          {item.variants && item.variants.length > 0 && (
            <CollapsibleSection
              id="item-config-variants"
              title="Select Variant"
              defaultOpen={true}
              status={variantStatus}
              persist={false}
            >
              <div className="space-y-2">
                {item.variants.map((variant) => (
                  <label
                    key={variant.id}
                    className={`flex items-center p-3 border-2 rounded-lg cursor-pointer transition-colors ${
                      config.variantId === variant.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="variant"
                      checked={config.variantId === variant.id}
                      onChange={() => {
                        const newSize = variant.size_key ?? null;
                        const modifiers = (config.modifiers ?? []).filter((m) => {
                          const md = item.modifier_groups?.flatMap((g) => g.modifiers).find((x) => x.id === m.modifierId);
                          return !md || isModAvailableForSize(md, newSize);
                        });
                        onConfigChange({ ...config, variantId: variant.id, modifiers });
                      }}
                      className="mr-3"
                    />
                    <div className="flex-1">
                      <span className="font-medium">{variant.name}</span>
                      <span className="ml-2 text-gray-700">
                        {formatCurrency((item.price ?? 0) + variant.price_modifier)}
                      </span>
                    </div>
                  </label>
                ))}
              </div>
            </CollapsibleSection>
          )}

          {item.modifier_groups && item.modifier_groups.length > 0 && (
            <CollapsibleSection
              id="item-config-modifiers"
              title="Modifiers"
              defaultOpen={!(item.variants && item.variants.length > 0)}
              status={modifierStatus}
              persist={false}
            >
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {item.modifier_groups.map((group, groupIndex) => {
                  const selectedInGroup = (config.modifiers ?? []).filter(m =>
                    group.modifiers.some(mod => mod.id === m.modifierId)
                  );
                  // Options not available for the chosen size (e.g. Thin Crust on 7") are hidden.
                  const visibleModifiers = group.modifiers.filter((mod) => isModAvailableForSize(mod, sizeKey));
                  // max_select / min_select bound TOTAL UNITS in the group (so "1 dip
                  // selected twice" fills a "choose 2" group), not the count of distinct options.
                  const unitsInGroup = selectedInGroup.reduce((s, m) => s + (m.quantity || 1), 0);
                  const minSelect = group.min_select ?? 0;
                  const maxUnits = group.max_select ?? 99;
                  const minOk = unitsInGroup >= minSelect;
                  const atMax = unitsInGroup >= maxUnits;
                  const isSingleSelect = (group.max_select ?? 0) === 1;
                  // "First N free" allowance for this group (per size, else flat).
                  const includedFree =
                    sizeKey && group.included_by_size && group.included_by_size[sizeKey] != null
                      ? Number(group.included_by_size[sizeKey])
                      : group.included_quantity ?? 0;
                  // Allocate the free allowance to the cheapest selected units first.
                  const priceOfMod = (id: number) => {
                    const m = group.modifiers.find((mm) => mm.id === id);
                    return m ? resolveModifierUnitPrice(m, sizeKey) : 0;
                  };
                  const freeUnitsByMod = new Map<number, number>();
                  let freeRemaining = includedFree;
                  for (const sel of [...selectedInGroup].sort((a, b) => priceOfMod(a.modifierId) - priceOfMod(b.modifierId))) {
                    const q = sel.quantity || 1;
                    const f = Math.max(0, Math.min(freeRemaining, q));
                    freeUnitsByMod.set(sel.modifierId, f);
                    freeRemaining -= f;
                  }
                  const groupStatus: SectionStatus =
                    minOk ? 'complete' : minSelect > 0 ? 'required-missing' : 'optional-empty';
                  const groupTitle = `${group.name} (choose ${group.min_select ?? 0}${group.max_select != null ? `–${group.max_select}` : '+'})`;
                  return (
                    <CollapsibleSection
                      key={group.id}
                      id={`item-config-modifier-group-${group.id}`}
                      title={groupTitle}
                      defaultOpen={groupIndex === 0}
                      status={groupStatus}
                      persist={false}
                    >
                      {!minOk && (
                        <p className="text-amber-600 text-xs mb-2">Select at least {minSelect}</p>
                      )}
                      {group.price_tiers && Object.keys(group.price_tiers).length > 0 ? (
                        <p className="text-emerald-700 text-xs mb-2">
                          {includedFree > 0 ? `First ${includedFree} free. ` : ''}Extra: {formatTiers(group.price_tiers)}
                        </p>
                      ) : includedFree > 0 ? (
                        <p className="text-emerald-700 text-xs mb-2">
                          First {includedFree} free — extras charged at the price shown.
                        </p>
                      ) : null}
                      <div className="space-y-1.5">
                        {visibleModifiers.map((mod) => {
                          const selected = (config.modifiers ?? []).find(m => m.modifierId === mod.id);
                          const isSelected = !!selected;
                          const unitPrice = resolveModifierUnitPrice(mod, sizeKey);
                          // Quantity stepper only where repeating an option is meaningful:
                          // it's priced, the group has a free allowance, or it's a "choose N"
                          // group (min>0). NOT for free optional toggles like "Remove a filling".
                          const canRepeat =
                            isSelected &&
                            !isSingleSelect &&
                            !!onUpdateModifierQuantity &&
                            (unitPrice > 0 || includedFree > 0 || minSelect > 0 || !!group.allow_quantity);
                          return (
                            <div
                              key={mod.id}
                              className={`flex items-center p-2 rounded ${
                                isSelected ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50'
                              }`}
                            >
                              <label className="flex items-center flex-1 cursor-pointer">
                                <input
                                  type={isSingleSelect ? 'radio' : 'checkbox'}
                                  name={isSingleSelect ? `modifier-group-${group.id}` : undefined}
                                  checked={isSelected}
                                  disabled={!isSelected && atMax && !isSingleSelect}
                                  onChange={() => onToggleModifier(mod.id)}
                                  className="mr-2"
                                />
                                <span className="font-medium">{mod.name}</span>
                                {(() => {
                                  if (unitPrice <= 0) return null;
                                  const qty = selected?.quantity || 1;
                                  const freeUnits = freeUnitsByMod.get(mod.id) ?? 0;
                                  if (isSelected) {
                                    const charged = qty - freeUnits;
                                    return charged <= 0 ? (
                                      <span className="ml-2 text-emerald-600 text-sm">Included</span>
                                    ) : (
                                      <span className="ml-2 text-green-600 text-sm">+ {formatCurrency(unitPrice * charged)}</span>
                                    );
                                  }
                                  // Not selected: free if the group still has free allowance left.
                                  return freeRemaining > 0 ? (
                                    <span className="ml-2 text-emerald-600 text-sm">Free</span>
                                  ) : (
                                    <span className="ml-2 text-green-600 text-sm">+ {formatCurrency(unitPrice)}</span>
                                  );
                                })()}
                              </label>
                              {canRepeat && (
                                <div className="inline-flex items-center overflow-hidden rounded-lg border border-gray-300">
                                  <button
                                    type="button"
                                    onClick={() => onUpdateModifierQuantity!(mod.id, (selected?.quantity || 1) - 1)}
                                    aria-label="Decrease quantity"
                                    className="px-2 py-0.5 text-gray-700 hover:bg-gray-100"
                                  >
                                    <MdRemove className="h-4 w-4" />
                                  </button>
                                  <span className="min-w-[2rem] px-1 text-center text-sm font-semibold tabular-nums">
                                    {selected?.quantity || 1}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => onUpdateModifierQuantity!(mod.id, (selected?.quantity || 1) + 1)}
                                    disabled={atMax}
                                    aria-label="Increase quantity"
                                    className="px-2 py-0.5 text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    <MdAdd className="h-4 w-4" />
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </CollapsibleSection>
                  );
                })}
              </div>
            </CollapsibleSection>
          )}

          {item.addons && item.addons.length > 0 && (
            <CollapsibleSection
              id="item-config-addons"
              title="Add-ons"
              defaultOpen={!(item.variants?.length || item.modifier_groups?.length)}
              status={addonStatus}
              persist={false}
            >
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {item.addons.map((addon) => {
                  const isSelected = config.addons.some(a => a.addonId === addon.id);
                  const selectedAddon = config.addons.find(a => a.addonId === addon.id);

                  return (
                    <div
                      key={addon.id}
                      className={`p-3 border-2 rounded-lg ${
                        isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                      }`}
                    >
                      <label className="flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => onToggleAddon(addon.id)}
                          className="mr-3"
                        />
                        <div className="flex-1">
                          <span className="font-medium">{addon.name}</span>
                          <span className="ml-2 text-green-600">+ {formatCurrency(addon.price)}</span>
                        </div>
                      </label>
                      {isSelected && (
                        <div className="mt-2 ml-6 flex items-center gap-2">
                          <label className="text-sm">Quantity:</label>
                          <div className="inline-flex items-center overflow-hidden rounded-lg border border-gray-300">
                            <button
                              type="button"
                              onClick={() => onUpdateAddonQuantity(addon.id, Math.max(1, (selectedAddon?.quantity || 1) - 1))}
                              disabled={(selectedAddon?.quantity || 1) <= 1}
                              aria-label="Decrease quantity"
                              className="px-2.5 py-1 text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <MdRemove className="h-4 w-4" />
                            </button>
                            <span className="min-w-[2.5rem] px-2 py-1 text-center text-sm font-semibold tabular-nums">
                              {selectedAddon?.quantity || 1}
                            </span>
                            <button
                              type="button"
                              onClick={() => onUpdateAddonQuantity(addon.id, (selectedAddon?.quantity || 1) + 1)}
                              aria-label="Increase quantity"
                              className="px-2.5 py-1 text-gray-700 hover:bg-gray-100"
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
            </CollapsibleSection>
          )}

          <CollapsibleSection
            id="item-config-notes"
            title="Special Instructions (Optional)"
            defaultOpen={!(item.variants?.length || item.modifier_groups?.length || item.addons?.length)}
            status={notesStatus}
            persist={false}
          >
            <textarea
              value={config.notes || ''}
              onChange={(e) => onConfigChange({ ...config, notes: e.target.value })}
              rows={3}
              placeholder="e.g., No onions, extra spicy"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </CollapsibleSection>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={onConfirm}>
              Add to Order
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
};

export default ItemConfigModal;

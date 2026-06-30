import React, { useState, useMemo, useEffect } from 'react';
import Modal from '../../../components/Modal';
import Button from '../../../components/Button';
import { formatCurrency } from '../../../utils/currency';
import { MenuItem } from '../../../types';
import type { DealDefinition, DealSlot } from '../../../services/api/menuService';
import type { DealComponentLine } from './types';
import { defaultVariantIdForItem, type ItemConfig } from './types';
import ItemConfigModal from './ItemConfigModal';
import CollapsibleSection, { type SectionStatus } from './CollapsibleSection';

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

const DealConfigModal: React.FC<DealConfigModalProps> = ({
  isOpen,
  onClose,
  deal,
  initialComponents,
  onConfirm,
}) => {
  const [slotStates, setSlotStates] = useState<Map<number, SlotState>>(new Map());
  const [customizeTarget, setCustomizeTarget] = useState<{ slotIndex: number; pickIdx: number } | null>(null);

  // A choice slot for N>1 lets the customer pick N items independently (e.g. 2 different
  // drinks). Fixed slots and single-unit choice slots stay one pick of quantity N / 1.
  const isMultiPick = (slot: DealSlot) => slot.type !== 'fixed' && (slot.quantity ?? 1) > 1;
  const pickCount = (slot: DealSlot) => (isMultiPick(slot) ? slot.quantity : 1);
  const pickQuantity = (slot: DealSlot) => (isMultiPick(slot) ? 1 : slot.quantity ?? 1);

  // A customizable group survives in-deal filtering (cross-sell groups are hidden in deals).
  const hasOptions = (item: MenuItem | null) =>
    !!item &&
    !!(item.variants?.length || item.addons?.length || item.modifier_groups?.some((g) => !g.hide_in_deals));

  // When a slot is size-locked (e.g. "All 12\" pizzas"), pre-select that size variant.
  const variantIdForSlot = (item: MenuItem | null, slot: DealSlot): number | undefined => {
    if (!item) return undefined;
    if (slot.slot_size_key) {
      const v = item.variants?.find((vr) => (vr.size_key ?? null) === slot.slot_size_key);
      if (v) return v.id;
    }
    return defaultVariantIdForItem(item);
  };

  const initPick = (slot: DealSlot, item: MenuItem | null): SlotPick => ({
    selectedItem: item,
    config: { addons: [], modifiers: [], variantId: variantIdForSlot(item, slot) },
  });

  const initSlotState = (slot: DealSlot): SlotState => {
    if (slot.type === 'fixed' && slot.choice_items?.length === 1) {
      return { picks: [initPick(slot, slot.choice_items[0] ?? null)] };
    }
    if (slot.type === 'choice_category' || slot.type === 'choice_list') {
      const first = slot.choice_items?.[0] ?? null;
      // Pre-select the first option for each unit; the customer can change any of them.
      return { picks: Array.from({ length: pickCount(slot) }, () => initPick(slot, first)) };
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, deal?.deal_menu_item_id, initialComponents]);

  const getSlotState = (slotIndex: number, slot: DealSlot): SlotState => {
    return slotStates.get(slotIndex) ?? initSlotState(slot);
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

  const allSlotsComplete = useMemo(() => {
    if (!deal?.slots?.length) return false;
    return deal.slots.every((slot) => {
      const state = getSlotState(slot.slot_index, slot);
      if (slot.type === 'fixed') return state.picks.every((p) => p.selectedItem != null);
      if (slot.choice_items?.length) return state.picks.length > 0 && state.picks.every((p) => p.selectedItem != null);
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deal, slotStates]);

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
        });
      });
    });
    onConfirm({
      dealId: deal.deal_menu_item_id,
      dealName: deal.name,
      dealPrice: deal.price,
      components,
    });
    setSlotStates(new Map());
    setCustomizeTarget(null);
    onClose();
  };

  const handleClose = () => {
    setSlotStates(new Map());
    setCustomizeTarget(null);
    onClose();
  };

  const customizeSlot = customizeTarget ? deal?.slots.find((s) => s.slot_index === customizeTarget.slotIndex) ?? null : null;
  const customizePick = customizeTarget
    ? slotStates.get(customizeTarget.slotIndex)?.picks[customizeTarget.pickIdx] ?? null
    : null;
  const rawItemToCustomize = customizePick?.selectedItem ?? null;
  // Inside a deal, hide cross-sell groups ("Add a drink(s)", "Add a dip(s)") — the deal
  // provides those through its own slots, so they shouldn't be offered/charged again.
  const itemToCustomize = rawItemToCustomize
    ? {
        ...rawItemToCustomize,
        modifier_groups: (rawItemToCustomize.modifier_groups ?? []).filter((g) => !g.hide_in_deals),
      }
    : null;
  const configToCustomize = customizePick?.config ?? { addons: [], modifiers: [] };
  const applyCustomizeConfig = (config: ItemConfig) => {
    if (customizeTarget) setPick(customizeTarget.slotIndex, customizeTarget.pickIdx, { config });
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        title={deal ? `Configure: ${deal.name}` : 'Configure Deal'}
        size="large"
      >
        {deal && (
          <div className="space-y-6">
            <p className="text-sm text-foodies-textSecondary">
              {formatCurrency(deal.price)} — Select options for each slot below.
            </p>
            {deal.slots.map((slot) => {
              const state = getSlotState(slot.slot_index, slot);
              const choiceItems = slot.choice_items ?? [];
              const isFixed = slot.type === 'fixed' && choiceItems.length <= 1;
              const multi = isMultiPick(slot);
              const slotComplete = state.picks.length > 0 && state.picks.every((p) => p.selectedItem != null);
              const slotStatus: SectionStatus = slotComplete ? 'complete' : 'required-missing';
              const slotTitle = `Slot ${slot.slot_index + 1}: ${
                isFixed
                  ? `${slot.quantity}x Item`
                  : multi
                    ? `Choose ${slot.quantity} (mix & match)`
                    : `${slot.quantity}x Choose one`
              }`;

              return (
                <CollapsibleSection
                  key={slot.slot_index}
                  id={`deal-slot-${slot.slot_index}`}
                  title={slotTitle}
                  defaultOpen={true}
                  status={slotStatus}
                  persist={false}
                >
                  <div className="space-y-2 pt-1">
                    {isFixed && choiceItems[0] && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-foodies-textPrimary">{choiceItems[0].name}</span>
                        {slot.allow_customization && hasOptions(state.picks[0]?.selectedItem ?? null) && (
                          <Button
                            size="small"
                            variant="outline"
                            onClick={() => setCustomizeTarget({ slotIndex: slot.slot_index, pickIdx: 0 })}
                          >
                            Customize
                          </Button>
                        )}
                      </div>
                    )}
                    {!isFixed && choiceItems.length > 0 && (
                      <div className="space-y-4">
                        {state.picks.map((pick, pickIdx) => (
                          <div key={pickIdx} className={multi ? 'rounded-lg border border-foodies-border p-2' : ''}>
                            {multi && (
                              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-foodies-textSecondary">
                                Choice {pickIdx + 1}
                              </p>
                            )}
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                              {choiceItems.map((item) => {
                                const isSelected = pick.selectedItem?.id === item.id;
                                return (
                                  <button
                                    key={item.id}
                                    type="button"
                                    onClick={() =>
                                      setPick(slot.slot_index, pickIdx, {
                                        selectedItem: item,
                                        config: {
                                          addons: [],
                                          modifiers: [],
                                          variantId: variantIdForSlot(item, slot),
                                        },
                                      })
                                    }
                                    className={`p-3 rounded-lg border-2 text-left transition-colors ${
                                      isSelected
                                        ? 'border-foodies-primary bg-foodies-primary/10'
                                        : 'border-foodies-border hover:border-foodies-primary/50'
                                    }`}
                                  >
                                    <span className="font-medium text-foodies-textPrimary block truncate">{item.name}</span>
                                    {item.label && (
                                      <span className="mt-1 inline-block px-1.5 py-0.5 text-[10px] font-bold rounded bg-foodies-primary/10 text-foodies-primary">
                                        {item.label}
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                            {pick.selectedItem && slot.allow_customization && hasOptions(pick.selectedItem) && (
                              <Button
                                size="small"
                                variant="outline"
                                className="mt-2"
                                onClick={() => setCustomizeTarget({ slotIndex: slot.slot_index, pickIdx })}
                              >
                                Customize: {pick.selectedItem.name}
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </CollapsibleSection>
              );
            })}
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleConfirm} disabled={!allSlotsComplete}>
                {initialComponents ? 'Update deal' : 'Add Deal to Order'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
      <ItemConfigModal
        isOpen={customizeTarget != null && !!itemToCustomize}
        onClose={() => setCustomizeTarget(null)}
        item={itemToCustomize ?? null}
        lockedSizeKey={customizeSlot?.slot_size_key ?? undefined}
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
          const isSingleSelect = groupForModifier && (groupForModifier.max_select ?? 0) === 1;

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
            const max = group.max_select ?? 99;
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

export default DealConfigModal;

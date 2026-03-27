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

type SlotState = {
  selectedItem: MenuItem | null;
  config: ItemConfig;
};

const DealConfigModal: React.FC<DealConfigModalProps> = ({
  isOpen,
  onClose,
  deal,
  initialComponents,
  onConfirm,
}) => {
  const [slotStates, setSlotStates] = useState<Map<number, SlotState>>(new Map());
  const [customizeSlotIndex, setCustomizeSlotIndex] = useState<number | null>(null);

  const initSlotState = (slot: DealSlot): SlotState => {
    if (slot.type === 'fixed' && slot.choice_items?.length === 1) {
      const selected = slot.choice_items[0] ?? null;
      return {
        selectedItem: selected,
        config: {
          addons: [],
          modifiers: [],
          variantId: defaultVariantIdForItem(selected),
        },
      };
    }
    if (slot.type === 'choice_category' || slot.type === 'choice_list') {
      const first = slot.choice_items?.[0] ?? null;
      return {
        selectedItem: first,
        config: {
          addons: [],
          modifiers: [],
          variantId: defaultVariantIdForItem(first),
        },
      };
    }
    return { selectedItem: null, config: { addons: [], modifiers: [] } };
  };

  useEffect(() => {
    if (isOpen && deal?.slots?.length) {
      const initial = new Map<number, SlotState>();
      deal.slots.forEach((slot) => {
        const fromExisting = (initialComponents ?? []).find(
          (c) => (c.slot_index ?? slot.slot_index) === slot.slot_index,
        );
        if (fromExisting?.menuItem) {
          initial.set(slot.slot_index, {
            selectedItem: fromExisting.menuItem,
            config: {
              variantId: fromExisting.variantId,
              addons: fromExisting.addons ?? [],
              modifiers: fromExisting.modifiers ?? [],
              notes: fromExisting.notes,
            },
          });
        } else {
          initial.set(slot.slot_index, initSlotState(slot));
        }
      });
      setSlotStates(initial);
    }
  }, [isOpen, deal?.deal_menu_item_id, initialComponents]);

  const getSlotState = (slotIndex: number, slot: DealSlot): SlotState => {
    return slotStates.get(slotIndex) ?? initSlotState(slot);
  };

  const setSlotState = (slotIndex: number, state: Partial<SlotState>) => {
    setSlotStates((prev) => {
      const next = new Map(prev);
      const current = next.get(slotIndex) ?? { selectedItem: null, config: { addons: [], modifiers: [] } };
      next.set(slotIndex, { ...current, ...state });
      return next;
    });
  };

  const allSlotsComplete = useMemo(() => {
    if (!deal?.slots?.length) return false;
    return deal.slots.every((slot) => {
      const state = getSlotState(slot.slot_index, slot);
      if (slot.type === 'fixed') return state.selectedItem != null;
      if (slot.choice_items?.length) return state.selectedItem != null;
      return true;
    });
  }, [deal, slotStates]);

  const handleConfirm = () => {
    if (!deal || !allSlotsComplete) return;
    const components: DealComponentLine[] = deal.slots.map((slot) => {
      const state = slotStates.get(slot.slot_index) ?? initSlotState(slot);
      const qty = slot.quantity ?? 1;
      return {
        menuItem: state.selectedItem!,
        quantity: qty,
        slot_index: slot.slot_index,
        variantId: state.config.variantId,
        addons: state.config.addons ?? [],
        modifiers: state.config.modifiers ?? [],
        notes: state.config.notes,
      };
    });
    onConfirm({
      dealId: deal.deal_menu_item_id,
      dealName: deal.name,
      dealPrice: deal.price,
      components,
    });
    setSlotStates(new Map());
    setCustomizeSlotIndex(null);
    onClose();
  };

  const handleClose = () => {
    setSlotStates(new Map());
    setCustomizeSlotIndex(null);
    onClose();
  };

  const itemToCustomize = customizeSlotIndex != null ? slotStates.get(customizeSlotIndex)?.selectedItem : null;
  const configToCustomize = customizeSlotIndex != null ? slotStates.get(customizeSlotIndex)?.config ?? { addons: [], modifiers: [] } : { addons: [], modifiers: [] };

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
              const hasOptions =
                state.selectedItem &&
                (state.selectedItem.variants?.length || state.selectedItem.addons?.length || state.selectedItem.modifier_groups?.length);
              const slotStatus: SectionStatus = state.selectedItem != null ? 'complete' : 'required-missing';
              const slotTitle = `Slot ${slot.slot_index + 1}: ${slot.quantity}x ${slot.type === 'fixed' ? 'Item' : 'Choose one'}`;

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
                      {slot.allow_customization && hasOptions && (
                        <Button
                          size="small"
                          variant="outline"
                          onClick={() => setCustomizeSlotIndex(slot.slot_index)}
                        >
                          Customize
                        </Button>
                      )}
                    </div>
                  )}
                  {!isFixed && choiceItems.length > 0 && (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {choiceItems.map((item) => {
                          const isSelected = state.selectedItem?.id === item.id;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() =>
                                setSlotState(slot.slot_index, {
                                  selectedItem: item,
                                  config: {
                                    addons: [],
                                    modifiers: [],
                                    variantId: defaultVariantIdForItem(item),
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
                              <span className="text-xs text-foodies-textSecondary">
                                {formatCurrency(item.price ?? item.base_price ?? 0)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      {state.selectedItem && slot.allow_customization && hasOptions && (
                        <Button
                          size="small"
                          variant="outline"
                          onClick={() => setCustomizeSlotIndex(slot.slot_index)}
                        >
                          Customize: {state.selectedItem.name}
                        </Button>
                      )}
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
        isOpen={customizeSlotIndex != null && !!itemToCustomize}
        onClose={() => setCustomizeSlotIndex(null)}
        item={itemToCustomize ?? null}
        config={configToCustomize}
        onConfigChange={(config) =>
          customizeSlotIndex != null && setSlotState(customizeSlotIndex, { config })
        }
        onConfirm={() => setCustomizeSlotIndex(null)}
        onToggleAddon={(addonId) => {
          const current = configToCustomize.addons ?? [];
          const exists = current.some((a) => a.addonId === addonId);
          const newAddons = exists
            ? current.filter((a) => a.addonId !== addonId)
            : [...current, { addonId, quantity: 1 }];
          if (customizeSlotIndex != null) setSlotState(customizeSlotIndex, { config: { ...configToCustomize, addons: newAddons } });
        }}
        onToggleModifier={(modifierId) => {
          const current = configToCustomize.modifiers ?? [];
          const exists = current.some((m) => m.modifierId === modifierId);
          const groupForModifier = itemToCustomize?.modifier_groups?.find((g) =>
            g.modifiers.some((m) => m.id === modifierId),
          );
          const isSingleSelect = groupForModifier && (groupForModifier.max_select ?? 0) === 1;

          if (exists) {
            const newMods = current.filter((m) => m.modifierId !== modifierId);
            if (customizeSlotIndex != null) setSlotState(customizeSlotIndex, { config: { ...configToCustomize, modifiers: newMods } });
            return;
          }
          if (isSingleSelect && groupForModifier) {
            const clearedOthers = current.filter((m) => {
              const g = itemToCustomize?.modifier_groups?.find((gr) =>
                gr.modifiers.some((mod) => mod.id === m.modifierId),
              );
              return g?.id !== groupForModifier.id;
            });
            if (customizeSlotIndex != null) setSlotState(customizeSlotIndex, { config: { ...configToCustomize, modifiers: [...clearedOthers, { modifierId, quantity: 1 }] } });
            return;
          }
          if (customizeSlotIndex != null) setSlotState(customizeSlotIndex, { config: { ...configToCustomize, modifiers: [...current, { modifierId, quantity: 1 }] } });
        }}
        onUpdateAddonQuantity={(addonId, quantity) => {
          const current = configToCustomize.addons ?? [];
          const newAddons = current.map((a) =>
            a.addonId === addonId ? { ...a, quantity } : a,
          );
          if (customizeSlotIndex != null) setSlotState(customizeSlotIndex, { config: { ...configToCustomize, addons: newAddons } });
        }}
      />
    </>
  );
};

export default DealConfigModal;

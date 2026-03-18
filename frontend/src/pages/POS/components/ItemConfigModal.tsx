import React, { useMemo } from 'react';
import Modal from '../../../components/Modal';
import Button from '../../../components/Button';
import { formatCurrency } from '../../../utils/currency';
import { MenuItem } from '../../../types';
import { ItemConfig } from './types';
import CollapsibleSection, { type SectionStatus } from './CollapsibleSection';

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
}) => {
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
                      onChange={() => onConfigChange({ ...config, variantId: variant.id })}
                      className="mr-3"
                    />
                    <div className="flex-1">
                      <span className="font-medium">{variant.name}</span>
                      <span className={`ml-2 ${variant.price_modifier >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {variant.price_modifier >= 0 ? '+' : ''}{formatCurrency(Math.abs(variant.price_modifier))}
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
                  const count = selectedInGroup.length;
                  const minSelect = group.min_select ?? 0;
                  const minOk = count >= minSelect;
                  const maxOk = (group.max_select ?? 99) >= count;
                  const isSingleSelect = (group.max_select ?? 0) === 1;
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
                      <div className="space-y-1.5">
                        {group.modifiers.map((mod) => {
                          const isSelected = (config.modifiers ?? []).some(m => m.modifierId === mod.id);
                          return (
                            <label
                              key={mod.id}
                              className={`flex items-center p-2 rounded cursor-pointer ${
                                isSelected ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50'
                              }`}
                            >
                              <input
                                type={isSingleSelect ? 'radio' : 'checkbox'}
                                name={isSingleSelect ? `modifier-group-${group.id}` : undefined}
                                checked={isSelected}
                                disabled={!isSelected && !maxOk && !isSingleSelect}
                                onChange={() => onToggleModifier(mod.id)}
                                className="mr-2"
                              />
                              <span className="font-medium">{mod.name}</span>
                              <span className="ml-2 text-green-600 text-sm">+ {formatCurrency(mod.price)}</span>
                            </label>
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
                          <input
                            type="number"
                            min="1"
                            value={selectedAddon?.quantity || 1}
                            onChange={(e) => onUpdateAddonQuantity(addon.id, parseInt(e.target.value) || 1)}
                            className="w-20 px-2 py-1 border border-gray-300 rounded text-center"
                          />
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

import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import { adminService, ModifierGroupResponse, ModifierResponse } from '../../services/api/adminService';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useTypeaheadSuggestions } from '../../hooks/useTypeaheadSuggestions';
import Loader from '../../components/Loader';
import { formatCurrency } from '../../utils/currency';
import Button from '../../components/Button';
import ClearFiltersButton from '../../components/ClearFiltersButton';
import SearchableSelect from '../../components/SearchableSelect';
import Card from '../../components/Card';
import Modal from '../../components/Modal';
import PaginationBar, { DEFAULT_PAGE_SIZE } from '../../components/PaginationBar';
import { confirmDialog } from '../../utils/sweetAlert';
import TypeaheadDropdown from '../../components/TypeaheadDropdown';

const Modifiers: React.FC = () => {
  const queryClient = useQueryClient();
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [showModifierForm, setShowModifierForm] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ModifierGroupResponse | null>(null);
  const [editingModifier, setEditingModifier] = useState<{ modifier: ModifierResponse; group: ModifierGroupResponse } | null>(null);
  const [linkMenuItemsGroup, setLinkMenuItemsGroup] = useState<ModifierGroupResponse | null>(null);
  const [selectedMenuItemIds, setSelectedMenuItemIds] = useState<number[]>([]);
  const [groupFormData, setGroupFormData] = useState({
    brand_id: '',
    name: '',
    min_select: '0',
    max_select: '1',
  });
  const [modifierFormData, setModifierFormData] = useState({
    modifier_group_id: '',
    name: '',
    price: '',
  });
  const [editGroupFormData, setEditGroupFormData] = useState({ name: '', min_select: '0', max_select: '1' });
  const [editModifierFormData, setEditModifierFormData] = useState({ name: '', price: '' });
  const [filters, setFilters] = useState<{ brand_id: string; search: string }>({ brand_id: '', search: '' });
  const debouncedModifierSearch = useDebouncedValue(filters.search, 300);
  const [linkingInProgress, setLinkingInProgress] = useState(false);
  const [page, setPage] = useState(1);

  const { data: brands } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const response = await apiClient.get<{ id: number; name: string; tenant_name?: string }[]>('/admin/brands');
      return response.data;
    },
  });

  const effectiveBrandId = filters.brand_id ? +filters.brand_id : null;

  const { data: modifierGroups, isLoading } = useQuery({
    queryKey: ['modifierGroups', effectiveBrandId],
    queryFn: () =>
      adminService.getModifierGroups(
        effectiveBrandId != null ? { brand_id: effectiveBrandId } : undefined,
      ),
    enabled: true,
  });

  const filteredGroups = useMemo(() => {
    const groups = (modifierGroups ?? []) as ModifierGroupResponse[];
    if (!debouncedModifierSearch.trim()) return groups;
    const q = debouncedModifierSearch.trim().toLowerCase();
    return groups.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        (g.modifiers ?? []).some((m) => m.name.toLowerCase().includes(q)),
    );
  }, [modifierGroups, debouncedModifierSearch]);

  const modifierSearchTypeahead = useTypeaheadSuggestions({
    query: debouncedModifierSearch,
    options: (modifierGroups ?? []).flatMap((g: any) => [
      { id: `g-${g.id}`, label: g.name ?? '' },
      ...((g.modifiers ?? []).map((m: any) => ({ id: `m-${m.id}`, label: m.name ?? '' }))),
    ]),
    minChars: 2,
    limit: 8,
  });

  const paginatedGroups = useMemo(() => {
    const start = (page - 1) * DEFAULT_PAGE_SIZE;
    return filteredGroups.slice(start, start + DEFAULT_PAGE_SIZE);
  }, [filteredGroups, page]);
  useEffect(() => setPage(1), [filters.brand_id, debouncedModifierSearch]);

  const { data: menuItemsForLink } = useQuery({
    queryKey: ['menuItemsForModifierLink', linkMenuItemsGroup?.brand_id],
    queryFn: async () => {
      if (linkMenuItemsGroup?.brand_id == null) return [];
      return adminService.getMenuItems({ brand_id: linkMenuItemsGroup.brand_id });
    },
    enabled: linkMenuItemsGroup != null && linkMenuItemsGroup.brand_id != null,
  });

  useEffect(() => {
    if (linkMenuItemsGroup) {
      setSelectedMenuItemIds([]);
    }
  }, [linkMenuItemsGroup?.id]);

  useEffect(() => {
    if (editingGroup) {
      setEditGroupFormData({
        name: editingGroup.name,
        min_select: String(editingGroup.min_select ?? 0),
        max_select: String(editingGroup.max_select ?? 1),
      });
    }
  }, [editingGroup]);

  useEffect(() => {
    if (editingModifier) {
      setEditModifierFormData({
        name: editingModifier.modifier.name,
        price: String(editingModifier.modifier.price ?? 0),
      });
    }
  }, [editingModifier]);

  const createGroupMutation = useMutation({
    mutationFn: (data: { brand_id: number; name: string; min_select?: number; max_select?: number }) =>
      adminService.createModifierGroup(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['modifierGroups'] });
      setShowGroupForm(false);
      setGroupFormData({ brand_id: '', name: '', min_select: '0', max_select: '1' });
      toast.success('Modifier group created.');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed to create group'),
  });

  const updateGroupMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name?: string; min_select?: number; max_select?: number } }) =>
      adminService.updateModifierGroup(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['modifierGroups'] });
      setEditingGroup(null);
      toast.success('Modifier group updated.');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed to update group'),
  });

  const deleteGroupMutation = useMutation({
    mutationFn: (id: number) => adminService.deleteModifierGroup(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['modifierGroups'] });
      toast.success('Modifier group deleted.');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed to delete group'),
  });

  const createModifierMutation = useMutation({
    mutationFn: (data: { modifier_group_id: number; name: string; price?: number }) =>
      adminService.createModifier(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['modifierGroups'] });
      setShowModifierForm(false);
      setModifierFormData({ modifier_group_id: '', name: '', price: '' });
      toast.success('Modifier created.');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed to create modifier'),
  });

  const updateModifierMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name?: string; price?: number } }) =>
      adminService.updateModifier(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['modifierGroups'] });
      setEditingModifier(null);
      toast.success('Modifier updated.');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed to update modifier'),
  });

  const deleteModifierMutation = useMutation({
    mutationFn: (id: number) => adminService.deleteModifier(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['modifierGroups'] });
      toast.success('Modifier deleted.');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed to delete modifier'),
  });

  const isSubmitting =
    createGroupMutation.isPending ||
    updateGroupMutation.isPending ||
    createModifierMutation.isPending ||
    updateModifierMutation.isPending ||
    deleteModifierMutation.isPending ||
    deleteGroupMutation.isPending ||
    linkingInProgress;
  if (isLoading || isSubmitting) {
    return <Loader fullScreen text={isSubmitting ? 'Saving...' : 'Loading modifiers...'} />;
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-slate-100">Modifiers</h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setShowModifierForm(true)}>
            + Add Modifier
          </Button>
          <Button onClick={() => setShowGroupForm(true)}>+ Add Modifier Group</Button>
        </div>
      </div>

      <Card className="mb-4 p-4 dark:bg-slate-800 dark:border-slate-700">
        <div className="flex flex-wrap gap-3 items-end">
          <SearchableSelect
            label="Brand"
            value={filters.brand_id}
            onChange={(v) => setFilters((f) => ({ ...f, brand_id: v }))}
            options={[
              { value: '', label: 'Select brand' },
              ...(brands ?? []).map((b) => ({
                value: String(b.id),
                label: b.tenant_name ? `${b.name} (${b.tenant_name})` : b.name,
              })),
            ]}
            placeholder="Select brand"
            minWidth="min-w-[180px]"
          />
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Search</label>
            <div className="relative">
              <input
                type="text"
                value={filters.search}
                onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                onFocus={() => modifierSearchTypeahead.setOpen(true)}
                onKeyDown={(e) => {
                  const suggestions = modifierSearchTypeahead.suggestions;
                  if (!suggestions.length) return;
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    modifierSearchTypeahead.setActiveIndex(Math.min(modifierSearchTypeahead.activeIndex + 1, suggestions.length - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    modifierSearchTypeahead.setActiveIndex(Math.max(modifierSearchTypeahead.activeIndex - 1, 0));
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const opt = suggestions[modifierSearchTypeahead.activeIndex];
                    if (opt?.label) setFilters((f) => ({ ...f, search: opt.label }));
                    modifierSearchTypeahead.setOpen(false);
                  } else if (e.key === 'Escape') {
                    modifierSearchTypeahead.setOpen(false);
                  }
                }}
                placeholder="Group or modifier name..."
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm w-48"
              />
              <TypeaheadDropdown
                open={modifierSearchTypeahead.open && filters.search.trim().length >= 2}
                suggestions={modifierSearchTypeahead.suggestions}
                activeIndex={modifierSearchTypeahead.activeIndex}
                onHoverIndex={modifierSearchTypeahead.setActiveIndex}
                onSelect={(opt) => {
                  setFilters((f) => ({ ...f, search: opt.label }));
                  modifierSearchTypeahead.setOpen(false);
                }}
                onClose={() => modifierSearchTypeahead.setOpen(false)}
              />
            </div>
          </div>
          <ClearFiltersButton onClick={() => setFilters({ brand_id: '', search: '' })} />
        </div>
      </Card>

      {/* Add Modifier Group modal */}
      <Modal
        isOpen={showGroupForm}
        onClose={() => {
          setShowGroupForm(false);
          setGroupFormData({ brand_id: '', name: '', min_select: '0', max_select: '1' });
        }}
        title="Add Modifier Group"
        size="medium"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!groupFormData.brand_id || !groupFormData.name.trim()) {
              toast.error('Brand and name are required.');
              return;
            }
            createGroupMutation.mutate({
              brand_id: +groupFormData.brand_id,
              name: groupFormData.name.trim(),
              min_select: parseInt(groupFormData.min_select, 10) || 0,
              max_select: parseInt(groupFormData.max_select, 10) || 1,
            });
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Brand *</label>
            <select
              value={groupFormData.brand_id}
              onChange={(e) => setGroupFormData({ ...groupFormData, brand_id: e.target.value })}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select brand</option>
              {brands?.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Group name *</label>
            <input
              type="text"
              value={groupFormData.name}
              onChange={(e) => setGroupFormData({ ...groupFormData, name: e.target.value })}
              placeholder="e.g. Peri Peri Flavour"
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Min select</label>
              <input
                type="number"
                min="0"
                value={groupFormData.min_select}
                onChange={(e) => setGroupFormData({ ...groupFormData, min_select: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max select</label>
              <input
                type="number"
                min="0"
                value={groupFormData.max_select}
                onChange={(e) => setGroupFormData({ ...groupFormData, max_select: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => setShowGroupForm(false)}>Cancel</Button>
            <Button type="submit" isLoading={createGroupMutation.isPending}>Create Group</Button>
          </div>
        </form>
      </Modal>

      {/* Edit Modifier Group modal */}
      <Modal
        isOpen={!!editingGroup}
        onClose={() => setEditingGroup(null)}
        title={editingGroup ? `Edit: ${editingGroup.name}` : 'Edit Group'}
        size="medium"
      >
        {editingGroup && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              updateGroupMutation.mutate({
                id: editingGroup.id,
                data: {
                  name: editGroupFormData.name.trim(),
                  min_select: parseInt(editGroupFormData.min_select, 10),
                  max_select: parseInt(editGroupFormData.max_select, 10),
                },
              });
            }}
            className="space-y-4"
          >
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Group name *</label>
              <input
                type="text"
                value={editGroupFormData.name}
                onChange={(e) => setEditGroupFormData({ ...editGroupFormData, name: e.target.value })}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Min select</label>
                <input
                  type="number"
                  min="0"
                  value={editGroupFormData.min_select}
                  onChange={(e) => setEditGroupFormData({ ...editGroupFormData, min_select: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Max select</label>
                <input
                  type="number"
                  min="0"
                  value={editGroupFormData.max_select}
                  onChange={(e) => setEditGroupFormData({ ...editGroupFormData, max_select: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => setEditingGroup(null)}>Cancel</Button>
              <Button type="submit" isLoading={updateGroupMutation.isPending}>Update</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Add Modifier modal */}
      <Modal
        isOpen={showModifierForm}
        onClose={() => {
          setShowModifierForm(false);
          setModifierFormData({ modifier_group_id: '', name: '', price: '' });
        }}
        title="Add Modifier"
        size="medium"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!modifierFormData.modifier_group_id || !modifierFormData.name.trim()) {
              toast.error('Group and name are required.');
              return;
            }
            createModifierMutation.mutate({
              modifier_group_id: +modifierFormData.modifier_group_id,
              name: modifierFormData.name.trim(),
              price: modifierFormData.price ? parseFloat(modifierFormData.price) : 0,
            });
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Modifier group *</label>
            <select
              value={modifierFormData.modifier_group_id}
              onChange={(e) => setModifierFormData({ ...modifierFormData, modifier_group_id: e.target.value })}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select group</option>
              {(modifierGroups ?? []).map((g: ModifierGroupResponse) => (
                <option key={g.id} value={g.id}>{g.name} {effectiveBrandId != null ? '' : `(${brands?.find((b) => b.id === g.brand_id)?.name ?? ''})`}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input
              type="text"
              value={modifierFormData.name}
              onChange={(e) => setModifierFormData({ ...modifierFormData, name: e.target.value })}
              placeholder="e.g. Lemon & Herb"
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Price</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={modifierFormData.price}
              onChange={(e) => setModifierFormData({ ...modifierFormData, price: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => setShowModifierForm(false)}>Cancel</Button>
            <Button type="submit" isLoading={createModifierMutation.isPending}>Create Modifier</Button>
          </div>
        </form>
      </Modal>

      {/* Edit Modifier modal */}
      <Modal
        isOpen={!!editingModifier}
        onClose={() => setEditingModifier(null)}
        title={editingModifier ? `Edit: ${editingModifier.modifier.name}` : 'Edit Modifier'}
        size="medium"
      >
        {editingModifier && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              updateModifierMutation.mutate({
                id: editingModifier.modifier.id,
                data: {
                  name: editModifierFormData.name.trim(),
                  price: editModifierFormData.price ? parseFloat(editModifierFormData.price) : 0,
                },
              });
            }}
            className="space-y-4"
          >
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
              <input
                type="text"
                value={editModifierFormData.name}
                onChange={(e) => setEditModifierFormData({ ...editModifierFormData, name: e.target.value })}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Price</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={editModifierFormData.price}
                onChange={(e) => setEditModifierFormData({ ...editModifierFormData, price: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => setEditingModifier(null)}>Cancel</Button>
              <Button type="submit" isLoading={updateModifierMutation.isPending}>Update</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Link to menu items modal */}
      <Modal
        isOpen={!!linkMenuItemsGroup}
        onClose={() => setLinkMenuItemsGroup(null)}
        title={linkMenuItemsGroup ? `Link "${linkMenuItemsGroup.name}" to menu items` : 'Link to menu items'}
        size="large"
      >
        {linkMenuItemsGroup && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Select menu items that should show this modifier group in POS. Only items from the same brand are listed.
            </p>
            <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg p-3 space-y-2">
              {(menuItemsForLink ?? []).length === 0 ? (
                <p className="text-gray-500 text-sm">No menu items for this brand. Create items in Menu Items first.</p>
              ) : (
                (menuItemsForLink ?? []).map((item: { id: number; name: string; modifier_groups?: { id: number }[] }) => {
                  const linked = (item.modifier_groups ?? []).some((mg: { id: number }) => mg.id === linkMenuItemsGroup.id);
                  const checked = selectedMenuItemIds.includes(item.id) || linked;
                  return (
                    <label key={item.id} className="flex items-center gap-3 cursor-pointer hover:bg-gray-50 p-2 rounded">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          if (linked) return;
                          setSelectedMenuItemIds((prev) =>
                            prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id],
                          );
                        }}
                        disabled={linked}
                        className="h-4 w-4 text-blue-600 rounded border-gray-300"
                      />
                      <span className="font-medium">{item.name}</span>
                      {linked && <span className="text-xs text-green-600">Already linked</span>}
                    </label>
                  );
                })
              )}
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setLinkMenuItemsGroup(null)}>Cancel</Button>
              <Button
                onClick={async () => {
                  if (selectedMenuItemIds.length === 0) {
                    toast.error('Select at least one menu item.');
                    return;
                  }
                  setLinkingInProgress(true);
                  try {
                    const items = (menuItemsForLink ?? []) as { id: number; modifier_groups?: { id: number }[] }[];
                    for (const menuItemId of selectedMenuItemIds) {
                      const item = items.find((i) => i.id === menuItemId);
                      const existingIds = (item?.modifier_groups ?? []).map((g) => g.id);
                      const newIds = Array.from(new Set([...existingIds, linkMenuItemsGroup.id]));
                      await adminService.linkModifierGroups(menuItemId, newIds);
                    }
                    queryClient.invalidateQueries({ queryKey: ['menuItems'] });
                    queryClient.invalidateQueries({ queryKey: ['modifierGroups'] });
                    setLinkMenuItemsGroup(null);
                    toast.success('Modifier group linked to selected menu items.');
                  } catch (e: any) {
                    toast.error(e.response?.data?.message || 'Failed to link');
                  } finally {
                    setLinkingInProgress(false);
                  }
                }}
                isLoading={linkingInProgress}
              >
                Link to selected items
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <div className="w-full space-y-3">
        {filteredGroups.length === 0 ? (
          <Card className="dark:bg-slate-800 dark:border-slate-700">
            <p className="text-center text-gray-500 dark:text-slate-400 py-12">
              {effectiveBrandId == null ? 'Select a brand to see modifier groups.' : 'No modifier groups found. Create a group above.'}
            </p>
          </Card>
        ) : (
          <>
          {paginatedGroups.map((group: ModifierGroupResponse) => (
            <Card key={group.id} hover>
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-800 mb-1">{group.name}</h3>
                  <p className="text-sm text-gray-600 mb-2">
                    Brand: {brands?.find((b) => b.id === group.brand_id)?.name ?? `#${group.brand_id}`} · Min: {group.min_select}, Max: {group.max_select}
                  </p>
                  {(group.modifiers ?? []).length > 0 ? (
                    <ul className="space-y-1">
                      {group.modifiers.map((m) => (
                        <li key={m.id} className="flex items-center gap-2 text-sm text-gray-700">
                          <span>{m.name}</span>
                          <span className="text-green-600 font-medium">{formatCurrency(Number(m.price))}</span>
                          <Button
                            size="small"
                            variant="edit"
                            onClick={() => setEditingModifier({ modifier: m, group })}
                          >
                            Edit
                          </Button>
                          <Button
                            size="small"
                            variant="danger"
                            onClick={() => {
                              (async () => {
                                const ok = await confirmDialog({
                                  title: `Delete modifier "${m.name}"?`,
                                  text: 'This action cannot be undone.',
                                  confirmText: 'Delete',
                                });
                                if (!ok) return;
                                deleteModifierMutation.mutate(m.id);
                              })();
                            }}
                            isLoading={deleteModifierMutation.isPending}
                          >
                            Delete
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-gray-500">No modifiers in this group.</p>
                  )}
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <Button size="small" variant="edit" onClick={() => setLinkMenuItemsGroup(group)}>
                    Link to menu items
                  </Button>
                  <Button
                    size="small"
                    variant="secondary"
                    onClick={() => {
                      setModifierFormData((prev) => ({ ...prev, modifier_group_id: String(group.id) }));
                      setShowModifierForm(true);
                    }}
                  >
                    Add modifier
                  </Button>
                  <Button size="small" variant="edit" onClick={() => setEditingGroup(group)}>
                    Edit group
                  </Button>
                  <Button
                    size="small"
                    variant="danger"
                    onClick={() => {
                      (async () => {
                        const ok = await confirmDialog({
                          title: `Delete group "${group.name}"?`,
                          text: 'This will also delete all modifiers inside this group.',
                          confirmText: 'Delete group',
                        });
                        if (!ok) return;
                        deleteGroupMutation.mutate(group.id);
                      })();
                    }}
                    isLoading={deleteGroupMutation.isPending}
                  >
                    Delete group
                  </Button>
                </div>
              </div>
            </Card>
          ))}
          <PaginationBar
            totalCount={filteredGroups.length}
            page={page}
            pageSize={DEFAULT_PAGE_SIZE}
            onPageChange={setPage}
            itemLabel="groups"
          />
          </>
        )}
      </div>
    </div>
  );
};

export default Modifiers;

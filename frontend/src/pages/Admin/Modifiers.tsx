import React, { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
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
import { useHasPermission } from '../../hooks/useHasPermission';
import TypeaheadDropdown from '../../components/TypeaheadDropdown';
import SizeMapEditor from '../../components/SizeMapEditor';

interface SortableModifierRowProps {
  modifier: ModifierResponse;
  group: ModifierGroupResponse;
  onEdit: () => void;
  onDelete: () => void;
  isDeleting: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

const SortableModifierRow: React.FC<SortableModifierRowProps> = ({ modifier, group: _group, onEdit, onDelete, isDeleting, canEdit, canDelete }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: modifier.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };
  return (
    <li ref={setNodeRef} style={style} className="flex items-center gap-2 text-sm text-gray-700 bg-white rounded p-1">
      <span
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 select-none px-1"
        title="Drag to reorder"
      >
        ⠿
      </span>
      <span className="flex-1">{modifier.name}</span>
      <span className="text-green-600 font-medium">{formatCurrency(Number(modifier.price))}</span>
      {canEdit && <Button size="small" variant="edit" onClick={onEdit}>Edit</Button>}
      {canDelete && <Button size="small" variant="danger" onClick={onDelete} isLoading={isDeleting}>Delete</Button>}
    </li>
  );
};

interface SortableGroupCardProps {
  group: ModifierGroupResponse;
  brands: { id: number; name: string; tenant_name?: string }[] | undefined;
  localOrder: Map<number, number[]>;
  setLocalOrder: React.Dispatch<React.SetStateAction<Map<number, number[]>>>;
  sensors: ReturnType<typeof useSensors>;
  onReorderModifiers: (groupId: number, newIds: number[]) => void;
  onEditModifier: (modifier: ModifierResponse) => void;
  onDeleteModifier: (id: number) => void;
  isDeletingModifier: boolean;
  onAddModifier: (groupId: number) => void;
  onEditGroup: () => void;
  onDeleteGroup: () => void;
  isDeletingGroup: boolean;
  onLinkMenuItems: () => void;
  reorderDisabled?: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

const SortableGroupCard: React.FC<SortableGroupCardProps> = ({
  group, brands, localOrder, setLocalOrder, sensors,
  onReorderModifiers, onEditModifier, onDeleteModifier, isDeletingModifier,
  onAddModifier, onEditGroup, onDeleteGroup, isDeletingGroup, onLinkMenuItems,
  reorderDisabled, canCreate, canEdit, canDelete,
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: group.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  const orderedIds = localOrder.get(group.id) ?? (group.modifiers ?? []).map((m) => m.id);
  const modById = new Map((group.modifiers ?? []).map((m) => [m.id, m]));
  const sortedMods = orderedIds.map((id) => modById.get(id)).filter(Boolean) as ModifierResponse[];

  return (
    <div ref={setNodeRef} style={style}>
      <Card hover>
        <div className="flex justify-between items-start gap-2">
          <span
            {...attributes}
            {...(reorderDisabled ? {} : listeners)}
            className={reorderDisabled ? 'text-gray-200 select-none text-xl mt-1 flex-shrink-0 cursor-not-allowed' : 'cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 select-none text-xl mt-1 flex-shrink-0'}
            title={reorderDisabled ? 'Select a menu item from the filter to reorder groups per item' : 'Drag to reorder group'}
          >⠿</span>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-gray-800 mb-1">{group.name}</h3>
            <p className="text-sm text-gray-600 mb-1">
              Brand: {brands?.find((b) => b.id === group.brand_id)?.name ?? `#${group.brand_id}`} · Min: {group.min_select}, Max: {group.max_select}
            </p>
            {(group.linked_menu_items ?? []).length > 0 && (
              <div className="flex flex-wrap gap-1">
                {(group.linked_menu_items ?? []).map((mi) => (
                  <span key={mi.id} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 border border-blue-200">
                    {mi.name}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-2 flex-shrink-0 flex-wrap justify-end">
            {canEdit && <Button size="small" variant="edit" onClick={onLinkMenuItems}>Link to menu items</Button>}
            {canCreate && <Button size="small" variant="secondary" onClick={() => onAddModifier(group.id)}>Add modifier</Button>}
            {canEdit && <Button size="small" variant="edit" onClick={onEditGroup}>Edit group</Button>}
            {canDelete && <Button size="small" variant="danger" onClick={onDeleteGroup} isLoading={isDeletingGroup}>Delete group</Button>}
          </div>
        </div>
        {sortedMods.length > 0 ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(event: DragEndEvent) => {
              const { active, over } = event;
              if (!over || active.id === over.id) return;
              const oldIds = localOrder.get(group.id) ?? group.modifiers.map((m) => m.id);
              const oldIdx = oldIds.indexOf(Number(active.id));
              const newIdx = oldIds.indexOf(Number(over.id));
              const newIds = arrayMove(oldIds, oldIdx, newIdx);
              setLocalOrder((prev) => new Map(prev).set(group.id, newIds));
              onReorderModifiers(group.id, newIds);
            }}
          >
            <SortableContext items={sortedMods.map((m) => m.id)} strategy={verticalListSortingStrategy}>
              <ul className="mt-3 space-y-1 border-t border-gray-100 dark:border-slate-600 pt-3">
                {sortedMods.map((m) => (
                  <SortableModifierRow
                    key={m.id}
                    modifier={m}
                    group={group}
                    onEdit={() => onEditModifier(m)}
                    onDelete={() => onDeleteModifier(m.id)}
                    isDeleting={isDeletingModifier}
                    canEdit={canEdit}
                    canDelete={canDelete}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        ) : (
          <p className="mt-3 text-sm text-gray-500 border-t border-gray-100 dark:border-slate-600 pt-3">No modifiers in this group.</p>
        )}
      </Card>
    </div>
  );
};

const SIZE_KEYS = ['7', '10', '12', '14'];

const Modifiers: React.FC = () => {
  const queryClient = useQueryClient();
  const canCreate = useHasPermission('modifiers:create');
  const canEdit = useHasPermission('modifiers:edit');
  const canDelete = useHasPermission('modifiers:delete');
  const [searchParams] = useSearchParams();
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
    min_select_by_size: null as Record<string, number> | null,
    max_select_by_size: null as Record<string, number> | null,
    included_quantity: '0',
    included_by_size: null as Record<string, number> | null,
  });
  const [modifierFormData, setModifierFormData] = useState({
    modifier_group_id: '',
    name: '',
    price: '',
    price_by_size: null as Record<string, number> | null,
  });
  const [editGroupFormData, setEditGroupFormData] = useState({ name: '', min_select: '0', max_select: '1', min_select_by_size: null as Record<string, number> | null, max_select_by_size: null as Record<string, number> | null, included_quantity: '0', included_by_size: null as Record<string, number> | null });
  const [editModifierFormData, setEditModifierFormData] = useState({ name: '', price: '', price_by_size: null as Record<string, number> | null });
  // Deep-link from the Menu Items page: ?brand_id= pre-filters the list.
  const [filters, setFilters] = useState<{ brand_id: string; search: string; menu_item_id: string }>({ brand_id: searchParams.get('brand_id') ?? '', search: '', menu_item_id: '' });
  const debouncedModifierSearch = useDebouncedValue(filters.search, 300);
  const [linkingInProgress, setLinkingInProgress] = useState(false);
  const [page, setPage] = useState(1);
  // Local modifier order per group (groupId → ordered modifier ids).
  const [localOrder, setLocalOrder] = useState<Map<number, number[]>>(new Map());
  // Local group order (brandId → ordered group ids) — used for brand-level reorder.
  const [localGroupOrder, setLocalGroupOrder] = useState<Map<number, number[]>>(new Map());
  // Local group order per menu item (itemId → ordered group ids) — used for per-item reorder.
  const [localItemGroupOrder, setLocalItemGroupOrder] = useState<Map<number, number[]>>(new Map());
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const { data: brands } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const response = await apiClient.get<{ id: number; name: string; tenant_name?: string }[]>('/admin/brands');
      return response.data;
    },
  });

  // Auto-select the brand when only one is accessible.
  const singleBrand = brands?.length === 1 ? brands[0] : null;
  useEffect(() => {
    if (singleBrand && !filters.brand_id) {
      setFilters((f) => ({ ...f, brand_id: String(singleBrand.id) }));
    }
  }, [singleBrand]);

  const effectiveBrandId = filters.brand_id ? +filters.brand_id : null;
  const effectiveMenuItemId = filters.menu_item_id ? +filters.menu_item_id : null;

  const { data: modifierGroups, isLoading } = useQuery({
    queryKey: ['modifierGroups', effectiveBrandId, effectiveMenuItemId],
    queryFn: () =>
      adminService.getModifierGroups(
        effectiveBrandId != null
          ? { brand_id: effectiveBrandId, ...(effectiveMenuItemId != null ? { menu_item_id: effectiveMenuItemId } : {}) }
          : undefined,
      ),
    enabled: true,
  });

  const { data: menuItemsForFilter } = useQuery({
    queryKey: ['menuItemsForModifierFilter', effectiveBrandId],
    queryFn: () => effectiveBrandId != null ? adminService.getMenuItems({ brand_id: effectiveBrandId }) : Promise.resolve([]),
    enabled: effectiveBrandId != null,
  });

  const filteredGroups = useMemo(() => {
    let groups = (modifierGroups ?? []) as ModifierGroupResponse[];
    if (effectiveMenuItemId != null) {
      // Per-item mode: server already filtered + sorted by per-item positions.
      // Apply optimistic local reorder on top.
      const itemOrder = localItemGroupOrder.get(effectiveMenuItemId);
      if (itemOrder) {
        groups = [...groups].sort((a, b) => {
          const ai = itemOrder.indexOf(a.id);
          const bi = itemOrder.indexOf(b.id);
          if (ai === -1 && bi === -1) return 0;
          if (ai === -1) return 1;
          if (bi === -1) return -1;
          return ai - bi;
        });
      }
    } else if (localGroupOrder.size > 0) {
      // Brand-level mode: apply optimistic brand-level reorder.
      groups = [...groups].sort((a, b) => {
        if (a.brand_id !== b.brand_id) return 0;
        const order = localGroupOrder.get(a.brand_id ?? -1);
        if (!order) return 0;
        const ai = order.indexOf(a.id);
        const bi = order.indexOf(b.id);
        if (ai === -1 && bi === -1) return 0;
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });
    }
    if (debouncedModifierSearch.trim()) {
      const q = debouncedModifierSearch.trim().toLowerCase();
      groups = groups.filter(
        (g) => g.name.toLowerCase().includes(q) || (g.modifiers ?? []).some((m) => m.name.toLowerCase().includes(q)),
      );
    }
    return groups;
  }, [modifierGroups, localGroupOrder, localItemGroupOrder, effectiveMenuItemId, debouncedModifierSearch]);

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
  useEffect(() => { setPage(1); setFilters((f) => ({ ...f, menu_item_id: '' })); }, [filters.brand_id]);
  useEffect(() => setPage(1), [debouncedModifierSearch, filters.menu_item_id]);

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
        min_select_by_size: editingGroup.min_select_by_size ?? null,
        max_select_by_size: editingGroup.max_select_by_size ?? null,
        included_quantity: String(editingGroup.included_quantity ?? 0),
        included_by_size: editingGroup.included_by_size ?? null,
      });
    }
  }, [editingGroup]);

  useEffect(() => {
    if (editingModifier) {
      setEditModifierFormData({
        name: editingModifier.modifier.name,
        price: String(editingModifier.modifier.price ?? 0),
        price_by_size: editingModifier.modifier.price_by_size ?? null,
      });
    }
  }, [editingModifier]);

  const createGroupMutation = useMutation({
    mutationFn: (data: { brand_id: number; name: string; min_select?: number; max_select?: number; min_select_by_size?: Record<string, number> | null; max_select_by_size?: Record<string, number> | null; included_quantity?: number; included_by_size?: Record<string, number> | null }) =>
      adminService.createModifierGroup(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['modifierGroups'] });
      setShowGroupForm(false);
      setGroupFormData({ brand_id: '', name: '', min_select: '0', max_select: '1', min_select_by_size: null, max_select_by_size: null, included_quantity: '0', included_by_size: null });
      toast.success('Modifier group created.');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed to create group'),
  });

  const updateGroupMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name?: string; min_select?: number; max_select?: number; min_select_by_size?: Record<string, number> | null; max_select_by_size?: Record<string, number> | null; included_quantity?: number; included_by_size?: Record<string, number> | null } }) =>
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
    mutationFn: (data: { modifier_group_id: number; name: string; price?: number; price_by_size?: Record<string, number> | null }) =>
      adminService.createModifier(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['modifierGroups'] });
      setShowModifierForm(false);
      setModifierFormData({ modifier_group_id: '', name: '', price: '', price_by_size: null });
      toast.success('Modifier created.');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed to create modifier'),
  });

  const updateModifierMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name?: string; price?: number; price_by_size?: Record<string, number> | null } }) =>
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

  const reorderMutation = useMutation({
    mutationFn: ({ groupId, orderedIds }: { groupId: number; orderedIds: number[] }) =>
      adminService.reorderModifiers(groupId, orderedIds),
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed to save order'),
  });

  const reorderGroupsMutation = useMutation({
    mutationFn: ({ brandId, orderedIds }: { brandId: number; orderedIds: number[] }) =>
      adminService.reorderModifierGroups(brandId, orderedIds),
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed to save group order'),
  });

  const reorderItemGroupsMutation = useMutation({
    mutationFn: ({ itemId, orderedIds }: { itemId: number; orderedIds: number[] }) =>
      adminService.reorderItemModifierGroups(itemId, orderedIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['modifierGroups', effectiveBrandId, effectiveMenuItemId] });
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed to save item group order'),
  });

  // Sync local orders from server data
  useEffect(() => {
    if (!modifierGroups) return;
    const groups = modifierGroups as ModifierGroupResponse[];
    setLocalOrder((prev) => {
      const next = new Map(prev);
      for (const g of groups) next.set(g.id, (g.modifiers ?? []).map((m) => m.id));
      return next;
    });
    if (effectiveMenuItemId != null) {
      // Per-item mode: server returned groups already sorted by per-item positions.
      setLocalItemGroupOrder((prev) => new Map(prev).set(effectiveMenuItemId, groups.map((g) => g.id)));
    } else {
      setLocalGroupOrder((prev) => {
        const next = new Map(prev);
        const byBrand = new Map<number, number[]>();
        for (const g of groups) {
          const arr = byBrand.get(g.brand_id) ?? [];
          arr.push(g.id);
          byBrand.set(g.brand_id, arr);
        }
        for (const [brandId, ids] of byBrand) next.set(brandId, ids);
        return next;
      });
    }
  }, [modifierGroups]);

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
          {canCreate && <Button variant="secondary" onClick={() => setShowModifierForm(true)}>
            + Add Modifier
          </Button>}
          {canCreate && <Button onClick={() => setShowGroupForm(true)}>+ Add Modifier Group</Button>}
        </div>
      </div>

      <Card className="mb-4 p-4 dark:bg-slate-800 dark:border-slate-700">
        <div className="flex flex-wrap gap-3 items-end">
          {!singleBrand && (
            <SearchableSelect
              label="Brand"
              value={filters.brand_id}
              onChange={(v) => setFilters((f) => ({ ...f, brand_id: v, menu_item_id: '' }))}
              options={[
                { value: '', label: 'All brands' },
                ...(brands ?? []).map((b) => ({
                  value: String(b.id),
                  label: b.tenant_name ? `${b.name} (${b.tenant_name})` : b.name,
                })),
              ]}
              placeholder="All brands"
              minWidth="min-w-[180px]"
            />
          )}
          {effectiveBrandId != null && (
            <SearchableSelect
              label="Menu Item"
              value={filters.menu_item_id}
              onChange={(v) => setFilters((f) => ({ ...f, menu_item_id: v }))}
              options={[
                { value: '', label: 'All items' },
                ...(menuItemsForFilter ?? []).map((mi: { id: number; name: string }) => ({
                  value: String(mi.id),
                  label: mi.name,
                })),
              ]}
              placeholder="All items"
              minWidth="min-w-[180px]"
            />
          )}
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
          <ClearFiltersButton onClick={() => setFilters(singleBrand ? { brand_id: String(singleBrand.id), search: '', menu_item_id: '' } : { brand_id: '', search: '', menu_item_id: '' })} />
        </div>
      </Card>

      {/* Add Modifier Group modal */}
      <Modal
        isOpen={showGroupForm}
        onClose={() => {
          setShowGroupForm(false);
          setGroupFormData({ brand_id: '', name: '', min_select: '0', max_select: '1', min_select_by_size: null, max_select_by_size: null, included_quantity: '0', included_by_size: null });
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
              min_select_by_size: groupFormData.min_select_by_size,
              max_select_by_size: groupFormData.max_select_by_size,
              included_quantity: parseInt(groupFormData.included_quantity, 10) || 0,
              included_by_size: groupFormData.included_by_size,
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
          <SizeMapEditor
            label="Min select per size (optional)"
            valueLabel="min"
            value={groupFormData.min_select_by_size}
            onChange={(m) => setGroupFormData({ ...groupFormData, min_select_by_size: m })}
            suggestedKeys={SIZE_KEYS}
            hint='Overrides "Min select" for matching sizes, e.g. large: 2, xl: 3.'
          />
          <SizeMapEditor
            label="Max select per size (optional)"
            valueLabel="max"
            value={groupFormData.max_select_by_size}
            onChange={(m) => setGroupFormData({ ...groupFormData, max_select_by_size: m })}
            suggestedKeys={SIZE_KEYS}
            hint='Overrides "Max select" for matching sizes, e.g. large: 2, xl: 3.'
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Included free (units)</label>
            <input
              type="number"
              min="0"
              value={groupFormData.included_quantity}
              onChange={(e) => setGroupFormData({ ...groupFormData, included_quantity: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">Units included before any are charged ("first N free"). Use per-size below to override by size.</p>
          </div>
          <SizeMapEditor
            label="Included free per size (optional)"
            valueLabel="free"
            value={groupFormData.included_by_size}
            onChange={(m) => setGroupFormData({ ...groupFormData, included_by_size: m })}
            suggestedKeys={SIZE_KEYS}
            hint='e.g. 2 free meats on 7"/10", 3 on 12"/14". Overrides "Included free" for matching sizes.'
          />
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
                  min_select_by_size: editGroupFormData.min_select_by_size,
                  max_select_by_size: editGroupFormData.max_select_by_size,
                  included_quantity: parseInt(editGroupFormData.included_quantity, 10) || 0,
                  included_by_size: editGroupFormData.included_by_size,
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
            <SizeMapEditor
              label="Min select per size (optional)"
              valueLabel="min"
              value={editGroupFormData.min_select_by_size}
              onChange={(m) => setEditGroupFormData({ ...editGroupFormData, min_select_by_size: m })}
              suggestedKeys={SIZE_KEYS}
              hint='Overrides "Min select" for matching sizes, e.g. large: 2, xl: 3.'
            />
            <SizeMapEditor
              label="Max select per size (optional)"
              valueLabel="max"
              value={editGroupFormData.max_select_by_size}
              onChange={(m) => setEditGroupFormData({ ...editGroupFormData, max_select_by_size: m })}
              suggestedKeys={SIZE_KEYS}
              hint='Overrides "Max select" for matching sizes, e.g. large: 2, xl: 3.'
            />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Included free (units)</label>
              <input
                type="number"
                min="0"
                value={editGroupFormData.included_quantity}
                onChange={(e) => setEditGroupFormData({ ...editGroupFormData, included_quantity: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">Units included before any are charged ("first N free").</p>
            </div>
            <SizeMapEditor
              label="Included free per size (optional)"
              valueLabel="free"
              value={editGroupFormData.included_by_size}
              onChange={(m) => setEditGroupFormData({ ...editGroupFormData, included_by_size: m })}
              suggestedKeys={SIZE_KEYS}
              hint='Overrides "Included free" for matching sizes.'
            />
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
          setModifierFormData({ modifier_group_id: '', name: '', price: '', price_by_size: null });
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
              price_by_size: modifierFormData.price_by_size,
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
            <label className="block text-sm font-medium text-gray-700 mb-1">Price (flat)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={modifierFormData.price}
              onChange={(e) => setModifierFormData({ ...modifierFormData, price: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">Used when no per-size price is set for the chosen size.</p>
          </div>
          <SizeMapEditor
            label="Price per size (optional)"
            valueLabel="price"
            value={modifierFormData.price_by_size}
            onChange={(m) => setModifierFormData({ ...modifierFormData, price_by_size: m })}
            suggestedKeys={SIZE_KEYS}
            hint='e.g. Extra Cheese 7"=99, 10"=149, 12"=249, 14"=349. Overrides the flat price for matching sizes.'
          />
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
                  price_by_size: editModifierFormData.price_by_size,
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Price (flat)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={editModifierFormData.price}
                onChange={(e) => setEditModifierFormData({ ...editModifierFormData, price: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">Used when no per-size price is set for the chosen size.</p>
            </div>
            <SizeMapEditor
              label="Price per size (optional)"
              valueLabel="price"
              value={editModifierFormData.price_by_size}
              onChange={(m) => setEditModifierFormData({ ...editModifierFormData, price_by_size: m })}
              suggestedKeys={SIZE_KEYS}
              hint='Overrides the flat price for matching sizes.'
            />
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
              No modifier groups found. Create a group above.
            </p>
          </Card>
        ) : (
          <>
          {!filters.menu_item_id && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Select a menu item above to drag-reorder groups for that item specifically.
            </p>
          )}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(event: DragEndEvent) => {
              const { active, over } = event;
              if (!over || active.id === over.id) return;
              const activeGroup = filteredGroups.find((g) => g.id === Number(active.id));
              if (!activeGroup) return;
              if (effectiveMenuItemId != null) {
                // Per-item reorder: only send the IDs of groups visible for this item
                const visibleIds = filteredGroups.map((g) => g.id);
                const oldIdx = visibleIds.indexOf(Number(active.id));
                const newIdx = visibleIds.indexOf(Number(over.id));
                if (oldIdx === -1 || newIdx === -1) return;
                const newIds = arrayMove(visibleIds, oldIdx, newIdx);
                setLocalItemGroupOrder((prev) => new Map(prev).set(effectiveMenuItemId, newIds));
                reorderItemGroupsMutation.mutate({ itemId: effectiveMenuItemId, orderedIds: newIds });
              } else {
                // Brand-level reorder
                const brandId = activeGroup.brand_id;
                const currentIds = localGroupOrder.get(brandId) ?? filteredGroups.filter((g) => g.brand_id === brandId).map((g) => g.id);
                const oldIdx = currentIds.indexOf(Number(active.id));
                const newIdx = currentIds.indexOf(Number(over.id));
                if (oldIdx === -1 || newIdx === -1) return;
                const newIds = arrayMove(currentIds, oldIdx, newIdx);
                setLocalGroupOrder((prev) => new Map(prev).set(brandId, newIds));
                reorderGroupsMutation.mutate({ brandId, orderedIds: newIds });
              }
            }}
          >
          <SortableContext items={paginatedGroups.map((g) => g.id)} strategy={verticalListSortingStrategy}>
          {paginatedGroups.map((group: ModifierGroupResponse) => (
            <SortableGroupCard
              key={group.id}
              group={group}
              brands={brands}
              localOrder={localOrder}
              setLocalOrder={setLocalOrder}
              sensors={sensors}
              reorderDisabled={!filters.menu_item_id}
              canCreate={canCreate}
              canEdit={canEdit}
              canDelete={canDelete}
              onReorderModifiers={(groupId, newIds) => reorderMutation.mutate({ groupId, orderedIds: newIds })}
              onEditModifier={(m) => setEditingModifier({ modifier: m, group })}
              onDeleteModifier={(id) => {
                (async () => {
                  const ok = await confirmDialog({ title: `Delete modifier?`, text: 'This action cannot be undone.', confirmText: 'Delete' });
                  if (!ok) return;
                  deleteModifierMutation.mutate(id);
                })();
              }}
              isDeletingModifier={deleteModifierMutation.isPending}
              onAddModifier={(groupId) => {
                setModifierFormData((prev) => ({ ...prev, modifier_group_id: String(groupId) }));
                setShowModifierForm(true);
              }}
              onEditGroup={() => setEditingGroup(group)}
              onDeleteGroup={() => {
                (async () => {
                  const ok = await confirmDialog({ title: `Delete group "${group.name}"?`, text: 'This will also delete all modifiers inside this group.', confirmText: 'Delete group' });
                  if (!ok) return;
                  deleteGroupMutation.mutate(group.id);
                })();
              }}
              isDeletingGroup={deleteGroupMutation.isPending}
              onLinkMenuItems={() => setLinkMenuItemsGroup(group)}
            />
          ))}
          </SortableContext>
          </DndContext>
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

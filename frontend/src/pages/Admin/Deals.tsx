import React, { useState, useMemo } from 'react';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useTypeaheadSuggestions } from '../../hooks/useTypeaheadSuggestions';
import TypeaheadDropdown from '../../components/TypeaheadDropdown';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import { adminService } from '../../services/api/adminService';
import Loader from '../../components/Loader';
import Button from '../../components/Button';
import SearchableSelect from '../../components/SearchableSelect';
import Card from '../../components/Card';
import Modal from '../../components/Modal';
import PaginationBar, { DEFAULT_PAGE_SIZE } from '../../components/PaginationBar';
import { AccentedList, AccentedListRow } from '../../components/AccentedListRow';
import { formatCurrency } from '../../utils/currency';

type DealSlotType = 'fixed' | 'choice_category' | 'choice_list';

interface DealListItem {
  id: number;
  name: string;
  base_price: number;
  is_active: boolean;
  brand_id: number;
  brand: { id: number; name: string } | null;
  category_id: number;
  category: { id: number; name: string } | null;
  slot_count: number;
}

interface DealSlot {
  id?: number;
  slot_index: number;
  type: DealSlotType;
  source_menu_item_id?: number | null;
  source_category_id?: number | null;
  source_menu_item_ids?: number[] | null;
  quantity: number;
  allow_customization: boolean;
  source_menu_item_name?: string | null;
  source_category_name?: string | null;
}

interface DealDetail {
  menu_item_id: number;
  brand_id?: number;
  brand?: { id: number; name: string } | null;
  name: string;
  base_price: number;
  category: { id: number; name: string } | null;
  slots: DealSlot[];
}

interface MenuItemOption {
  id: number;
  name: string;
  brand_id?: number;
  category_id?: number;
  category?: { id: number; name: string };
}

const DEAL_TYPE_LABELS: Record<DealSlotType, string> = {
  fixed: 'Fixed item',
  choice_category: 'Choice from category',
  choice_list: 'Choice from list',
};

const Deals: React.FC = () => {
  const queryClient = useQueryClient();
  const [brandFilter, setBrandFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [viewingDeal, setViewingDeal] = useState<DealDetail | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formStep, setFormStep] = useState<'select' | 'slots'>('select');
  const [editingDealId, setEditingDealId] = useState<number | null>(null);
  const [formName, setFormName] = useState<string>('');
  const [formPrice, setFormPrice] = useState<string>('');
  const [formSlots, setFormSlots] = useState<DealSlot[]>([]);
  const [formBrandId, setFormBrandId] = useState<string>('');
  const [formCategoryId, setFormCategoryId] = useState<string>('');
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [page, setPage] = useState(1);

  const effectiveBrandId = brandFilter ? +brandFilter : null;

  const { data: brands } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const res = await apiClient.get<{ id: number; name: string; tenant_name?: string }[]>('/admin/brands');
      return res.data;
    },
  });

  const { data: deals, isLoading } = useQuery({
    queryKey: ['deals', effectiveBrandId],
    queryFn: () => adminService.getDeals(effectiveBrandId != null ? { brand_id: effectiveBrandId } : undefined),
  });

  const { data: menuItemsForForm } = useQuery({
    queryKey: ['menuItems', formBrandId],
    queryFn: () => adminService.getMenuItems({ brand_id: +formBrandId }),
    enabled: !!formBrandId,
  });

  const { data: categoriesForForm } = useQuery({
    queryKey: ['menuCategories', formBrandId],
    queryFn: () => adminService.getCategories(formBrandId ? { brand_id: +formBrandId } : undefined),
    enabled: !!formBrandId,
  });

  const saveDealMutation = useMutation({
    mutationFn: async ({
      dealId,
      name,
      basePrice,
      brandId,
      categoryId,
      slots,
    }: {
      dealId: number | null;
      name: string;
      basePrice: number;
      brandId: number;
      categoryId: number;
      slots: DealSlot[];
    }) => {
      // A deal is a menu item plus slots. Create (or update) the menu item first,
      // then replace its deal components.
      let menuItemId: number;
      if (dealId == null) {
        const created = await adminService.createMenuItem({
          brand_id: brandId,
          category_id: categoryId,
          name,
          base_price: basePrice,
          is_active: true,
        });
        menuItemId = created.id;
      } else {
        await adminService.updateMenuItem(dealId, {
          name,
          base_price: basePrice,
          category_id: categoryId,
        });
        menuItemId = dealId;
      }
      return adminService.saveDeal(menuItemId, {
        slots: slots.map((s, i) => ({
          slot_index: i,
          type: s.type,
          source_menu_item_id: s.source_menu_item_id ?? null,
          source_category_id: s.source_category_id ?? null,
          source_menu_item_ids: s.source_menu_item_ids ?? null,
          quantity: s.quantity,
          allow_customization: s.allow_customization,
        })),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deals'] });
      queryClient.invalidateQueries({ queryKey: ['menuItems'] });
      setFormOpen(false);
      resetForm();
      toast.success('Deal saved successfully');
    },
    onError: (e: { response?: { data?: { message?: string } } }) => {
      toast.error(e.response?.data?.message || 'Failed to save deal');
    },
  });

  const deleteDealMutation = useMutation({
    mutationFn: (menuItemId: number) => adminService.deleteDeal(menuItemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deals'] });
      setDeletingId(null);
      toast.success('Deal removed (menu item is now a regular item)');
    },
    onError: (e: { response?: { data?: { message?: string } } }) => {
      toast.error(e.response?.data?.message || 'Failed to remove deal');
      setDeletingId(null);
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      adminService.updateMenuItem(id, { is_active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deals'] });
      queryClient.invalidateQueries({ queryKey: ['menuItems'] });
      toast.success('Deal status updated');
    },
    onError: (e: { response?: { data?: { message?: string } } }) => {
      toast.error(e.response?.data?.message || 'Failed to update status');
    },
  });

  const resetForm = () => {
    setFormStep('select');
    setEditingDealId(null);
    setFormName('');
    setFormPrice('');
    setFormSlots([]);
    setFormBrandId('');
    setFormCategoryId('');
  };

  const openView = async (row: DealListItem) => {
    try {
      const detail = await adminService.getDeal(row.id);
      if (detail) setViewingDeal(detail);
    } catch {
      toast.error('Failed to load deal');
    }
  };

  const openEdit = async (row: DealListItem) => {
    try {
      const detail = await adminService.getDeal(row.id);
      if (detail) {
        setEditingDealId(detail.menu_item_id);
        setFormName(detail.name ?? '');
        setFormPrice(detail.base_price != null ? String(detail.base_price) : '');
        setFormBrandId(String(detail.brand_id ?? ''));
        setFormCategoryId(detail.category ? String(detail.category.id) : '');
        setFormSlots(detail.slots.map((s: DealSlot) => ({ ...s })));
        setFormStep('slots');
        setFormOpen(true);
      }
    } catch {
      toast.error('Failed to load deal');
    }
  };

  const openAdd = () => {
    resetForm();
    setFormOpen(true);
  };

  const canContinue = !!formBrandId && !!formCategoryId && formName.trim().length > 0;

  const addSlot = () => {
    setFormSlots((prev) => [
      ...prev,
      {
        slot_index: prev.length,
        type: 'fixed',
        source_menu_item_id: null,
        source_category_id: null,
        source_menu_item_ids: null,
        quantity: 1,
        allow_customization: true,
      },
    ]);
  };

  const updateSlot = (index: number, patch: Partial<DealSlot>) => {
    setFormSlots((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  const removeSlot = (index: number) => {
    setFormSlots((prev) => prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, slot_index: i })));
  };

  const handleSave = () => {
    const name = formName.trim();
    if (!name) {
      toast.error('Enter a deal name');
      return;
    }
    if (!formBrandId || !formCategoryId) {
      toast.error('Select a brand and category');
      return;
    }
    const basePrice = parseFloat(formPrice);
    if (!Number.isFinite(basePrice) || basePrice < 0) {
      toast.error('Enter a valid deal price');
      return;
    }
    if (formSlots.length === 0) {
      toast.error('Add at least one slot to the deal');
      return;
    }
    const valid = formSlots.every((s: DealSlot) => {
      if (s.type === 'fixed') return s.source_menu_item_id != null;
      if (s.type === 'choice_category') return s.source_category_id != null;
      if (s.type === 'choice_list') return Array.isArray(s.source_menu_item_ids) && s.source_menu_item_ids.length > 0;
      return false;
    });
    if (!valid) {
      toast.error('Fill in source for each slot (fixed: one item, choice category: category, choice list: at least one item)');
      return;
    }
    saveDealMutation.mutate({
      dealId: editingDealId,
      name,
      basePrice,
      brandId: +formBrandId,
      categoryId: +formCategoryId,
      slots: formSlots,
    });
  };

  const dealList = (deals ?? []) as DealListItem[];
  const debouncedSearch = useDebouncedValue(search, 300);
  const dealTypeahead = useTypeaheadSuggestions({
    query: search,
    options: dealList.map((d) => ({ id: String(d.id), label: d.name })),
    minChars: 2,
    limit: 8,
  });
  const filteredDeals = useMemo(() => {
    if (!debouncedSearch.trim()) return dealList;
    const q = debouncedSearch.trim().toLowerCase();
    return dealList.filter((d) => d.name.toLowerCase().includes(q));
  }, [dealList, debouncedSearch]);
  const paginatedDeals = useMemo(() => {
    const start = (page - 1) * DEFAULT_PAGE_SIZE;
    return filteredDeals.slice(start, start + DEFAULT_PAGE_SIZE);
  }, [filteredDeals, page]);
  React.useEffect(() => setPage(1), [brandFilter, debouncedSearch]);

  const isSubmitting = saveDealMutation.isPending || deleteDealMutation.isPending;
  if (isLoading || isSubmitting) {
    return <Loader fullScreen text={isSubmitting ? 'Saving...' : 'Loading deals...'} />;
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-slate-100">Deals</h1>
        <Button variant="primary" onClick={openAdd}>Add deal</Button>
      </div>

      <Card className="mb-4 p-4 dark:bg-slate-800 dark:border-slate-700">
        <div className="flex flex-wrap gap-3 items-end">
          <SearchableSelect
            label="Brand"
            value={brandFilter}
            onChange={setBrandFilter}
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
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-slate-400 mb-1">Search deal name</label>
            <div className="relative">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onFocus={() => dealTypeahead.setOpen(true)}
                onKeyDown={(e) => {
                  const suggestions = dealTypeahead.suggestions;
                  if (!suggestions.length) return;
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    dealTypeahead.setActiveIndex(Math.min(dealTypeahead.activeIndex + 1, suggestions.length - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    dealTypeahead.setActiveIndex(Math.max(dealTypeahead.activeIndex - 1, 0));
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    const opt = suggestions[dealTypeahead.activeIndex];
                    if (opt?.label) setSearch(opt.label);
                    dealTypeahead.setOpen(false);
                  } else if (e.key === 'Escape') {
                    dealTypeahead.setOpen(false);
                  }
                }}
                placeholder="Deal name..."
                className="px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm w-48 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
              />
              <TypeaheadDropdown
                open={dealTypeahead.open && search.trim().length >= 2}
                suggestions={dealTypeahead.suggestions}
                activeIndex={dealTypeahead.activeIndex}
                onHoverIndex={dealTypeahead.setActiveIndex}
                onSelect={(opt) => {
                  setSearch(opt.label);
                  dealTypeahead.setOpen(false);
                }}
                onClose={() => dealTypeahead.setOpen(false)}
              />
            </div>
          </div>
        </div>
      </Card>

      <div className="w-full space-y-3">
        {filteredDeals.length === 0 ? (
          <Card className="dark:bg-slate-800 dark:border-slate-700">
            <p className="text-center text-gray-500 dark:text-slate-400 py-12">
              {dealList.length === 0
                ? 'No deals yet. Add a deal by entering a name, price and defining its slots.'
                : 'No deals match your search.'}
            </p>
          </Card>
        ) : (
          <>
            <AccentedList>
              {paginatedDeals.map((d, i) => (
                <AccentedListRow
                  key={d.id}
                  accent={d.is_active ? 'active' : 'inactive'}
                  initial={d.name.charAt(0)}
                  title={d.name}
                  subtitle={
                    <>
                      <p>{d.brand?.name ?? (brands?.find((b) => b.id === d.brand_id)?.name) ?? '—'} · {d.category?.name ?? '—'}</p>
                      <p>{formatCurrency(d.base_price)} · {d.slot_count} slot(s)</p>
                    </>
                  }
                  statusLabel={d.is_active ? 'Active' : 'Inactive'}
                  statusVariant={d.is_active ? 'active' : 'inactive'}
                  animationIndex={i}
                  actions={
                    <>
                      <Button size="small" variant="view" onClick={() => openView(d)}>View</Button>
                      <Button size="small" variant="edit" onClick={() => openEdit(d)}>Edit</Button>
                      <Button
                        size="small"
                        variant={d.is_active ? 'outline' : 'primary'}
                        isLoading={toggleActiveMutation.isPending}
                        onClick={() => toggleActiveMutation.mutate({ id: d.id, is_active: !d.is_active })}
                      >
                        {d.is_active ? 'Set inactive' : 'Set active'}
                      </Button>
                      <Button size="small" variant="danger" onClick={() => setDeletingId(d.id)}>Delete</Button>
                    </>
                  }
                />
              ))}
            </AccentedList>
            {filteredDeals.length > DEFAULT_PAGE_SIZE && (
              <PaginationBar totalCount={filteredDeals.length} page={page} pageSize={DEFAULT_PAGE_SIZE} onPageChange={setPage} itemLabel="deals" />
            )}
          </>
        )}
      </div>

      {/* View modal — user-friendly deal summary */}
      <Modal
        isOpen={!!viewingDeal}
        onClose={() => setViewingDeal(null)}
        title={viewingDeal ? viewingDeal.name : ''}
        size="large"
      >
        {viewingDeal && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Price</p>
                <p className="text-lg font-semibold text-gray-900">{formatCurrency(viewingDeal.base_price)}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Brand</p>
                <p className="text-gray-900">{viewingDeal.brand?.name ?? '—'}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Category</p>
                <p className="text-gray-900">{viewingDeal.category?.name ?? '—'}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Slots</p>
                <p className="text-gray-900">{viewingDeal.slots.length}</p>
              </div>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-3">Deal composition</h4>
              <div className="space-y-2">
                {viewingDeal.slots.map((s: DealSlot, i: number) => (
                  <div
                    key={s.id ?? i}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-3 text-sm"
                  >
                    <span className="inline-flex items-center px-2 py-0.5 rounded font-medium bg-blue-50 text-blue-800">
                      {DEAL_TYPE_LABELS[s.type]}
                    </span>
                    {s.type === 'fixed' && s.source_menu_item_name && (
                      <span className="text-gray-800">{s.source_menu_item_name}</span>
                    )}
                    {s.type === 'choice_category' && s.source_category_name && (
                      <span className="text-gray-800">{s.source_category_name}</span>
                    )}
                    {s.type === 'choice_list' && Array.isArray(s.source_menu_item_ids) && (
                      <span className="text-gray-800">{s.source_menu_item_ids.length} item(s) in list</span>
                    )}
                    <span className="text-gray-500">×{s.quantity}</span>
                    <span className="text-gray-400">
                      {s.allow_customization ? 'Customizable' : 'Fixed'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Add/Edit form modal */}
      <Modal
        isOpen={formOpen}
        onClose={() => { setFormOpen(false); resetForm(); }}
        title={
          formStep === 'select'
            ? (editingDealId == null ? 'Create deal' : 'Edit deal')
            : `${editingDealId == null ? 'Create deal' : 'Edit deal'}: ${formName.trim() || 'Untitled'}`
        }
      >
        {formStep === 'select' && (
          <div className="space-y-4">
            <SearchableSelect
              label="Brand"
              value={formBrandId}
              onChange={(v) => { setFormBrandId(v); setFormCategoryId(''); }}
              options={[
                { value: '', label: 'Select brand' },
                ...(brands ?? []).map((b) => ({
                  value: String(b.id),
                  label: b.tenant_name ? `${b.name} (${b.tenant_name})` : b.name,
                })),
              ]}
              placeholder="Select brand"
            />
            <SearchableSelect
              label="Category"
              value={formCategoryId}
              onChange={setFormCategoryId}
              options={[
                { value: '', label: 'Select category' },
                ...((categoriesForForm ?? []) as { id: number; name: string }[]).map((c) => ({
                  value: String(c.id),
                  label: c.name,
                })),
              ]}
              placeholder={formBrandId ? 'Select category' : 'Select a brand first'}
              disabled={!formBrandId}
            />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Deal name</label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Family Box"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-center justify-between gap-3 pt-1">
              {canContinue ? (
                <span />
              ) : (
                <p className="text-sm text-amber-600">Select a brand, category and enter a deal name to continue.</p>
              )}
              <Button onClick={() => setFormStep('slots')} disabled={!canContinue}>Continue</Button>
            </div>
          </div>
        )}

        {formStep === 'slots' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Define what goes into this deal. Add slots: fixed item, choice from category, or choice from a list.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Deal name</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Family Box"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Deal price</label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={formPrice}
                  onChange={(e) => setFormPrice(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            {formSlots.map((slot, idx) => (
              <SlotEditor
                key={idx}
                slot={slot}
                onChange={(patch) => updateSlot(idx, patch)}
                onRemove={() => removeSlot(idx)}
                categories={categoriesForForm ?? []}
                menuItems={(menuItemsForForm ?? []) as MenuItemOption[]}
              />
            ))}
            <div className="flex gap-2">
              <Button variant="secondary" onClick={addSlot}>+ Add slot</Button>
              <Button
                onClick={handleSave}
                disabled={saveDealMutation.isPending}
              >
                {saveDealMutation.isPending ? 'Saving...' : 'Save deal'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete confirm */}
      <Modal
        isOpen={deletingId != null}
        onClose={() => setDeletingId(null)}
        title="Remove deal?"
      >
        <p className="text-gray-600 mb-4">
          This will remove the deal configuration. The menu item will remain but become a regular item (no slots).
        </p>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={() => setDeletingId(null)}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() => deletingId != null && deleteDealMutation.mutate(deletingId)}
            disabled={deleteDealMutation.isPending}
          >
            {deleteDealMutation.isPending ? 'Removing...' : 'Remove deal'}
          </Button>
        </div>
      </Modal>
    </div>
  );
};

interface SlotEditorProps {
  slot: DealSlot;
  onChange: (patch: Partial<DealSlot>) => void;
  onRemove: () => void;
  categories: { id: number; name: string }[];
  menuItems: MenuItemOption[];
}

/** Single select with search (for fixed item or category). */
function DealFormSearchableSelect<T extends { id: number; name: string }>({
  label,
  placeholder,
  options,
  valueId,
  onChange,
  getOptionId,
}: {
  label: string;
  placeholder: string;
  options: T[];
  valueId: number | null;
  onChange: (id: number | null) => void;
  getOptionId: (o: T) => number;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const filtered = useMemo(() => {
    if (!debouncedSearch.trim()) return options;
    const q = debouncedSearch.trim().toLowerCase();
    return options.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, debouncedSearch]);
  const typeahead = useTypeaheadSuggestions({
    query: debouncedSearch,
    options: options.map((o) => ({ id: String(getOptionId(o)), label: o.name })),
    minChars: 2,
    limit: 8,
  });
  const selected = options.find((o) => getOptionId(o) === valueId);
  return (
    <div className="relative">
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 border border-gray-300 rounded-lg bg-white text-left text-sm focus:ring-2 focus:ring-blue-500"
      >
        <span className={selected ? 'text-gray-900' : 'text-gray-500'}>{selected?.name ?? placeholder}</span>
        <span className="text-gray-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <>
          <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg">
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => typeahead.setOpen(true)}
              onKeyDown={(e) => {
                const suggestions = typeahead.suggestions;
                if (!suggestions.length) return;
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  typeahead.setActiveIndex(Math.min(typeahead.activeIndex + 1, suggestions.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  typeahead.setActiveIndex(Math.max(typeahead.activeIndex - 1, 0));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  const opt = suggestions[typeahead.activeIndex];
                  if (opt?.label) setSearch(opt.label);
                  typeahead.setOpen(false);
                } else if (e.key === 'Escape') {
                  typeahead.setOpen(false);
                }
              }}
              className="w-full px-3 py-2 border-b border-gray-100 text-sm focus:outline-none focus:ring-0"
            />
            <div className="relative">
              <TypeaheadDropdown
                open={typeahead.open && search.trim().length >= 2}
                suggestions={typeahead.suggestions}
                activeIndex={typeahead.activeIndex}
                onHoverIndex={typeahead.setActiveIndex}
                onSelect={(opt) => {
                  setSearch(opt.label);
                  typeahead.setOpen(false);
                  setOpen(false);
                }}
                onClose={() => typeahead.setOpen(false)}
              />
            </div>
            <ul className="max-h-48 overflow-y-auto py-1">
              <li>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onChange(null);
                    setOpen(false);
                    setSearch('');
                  }}
                  className="w-full px-3 py-2 text-left text-sm text-gray-500 hover:bg-gray-50"
                >
                  — Clear
                </button>
              </li>
              {filtered.map((o) => (
                <li key={getOptionId(o)}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onChange(getOptionId(o));
                      setOpen(false);
                      setSearch('');
                    }}
                    className="w-full px-3 py-2 text-left text-sm text-gray-900 hover:bg-blue-50"
                  >
                    {o.name}
                  </button>
                </li>
              ))}
              {filtered.length === 0 && (
                <li className="px-3 py-2 text-sm text-gray-400">No matches</li>
              )}
            </ul>
          </div>
          <div
            className="fixed inset-0 z-[9]"
            aria-hidden
            onClick={() => setOpen(false)}
          />
        </>
      )}
    </div>
  );
}

/** Multi-select with search and checkboxes; selected items shown as removable chips. */
function SearchableMultiSelect({
  label,
  options,
  selectedIds,
  onChange,
}: {
  label: string;
  options: MenuItemOption[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
}) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const filtered = useMemo(() => {
    if (!debouncedSearch.trim()) return options;
    const q = debouncedSearch.trim().toLowerCase();
    return options.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, debouncedSearch]);
  const typeahead = useTypeaheadSuggestions({
    query: debouncedSearch,
    options: options.map((o) => ({ id: String(o.id), label: o.name })),
    minChars: 2,
    limit: 8,
  });
  const selectedItems = useMemo(
    () => options.filter((o) => selectedIds.includes(o.id)),
    [options, selectedIds],
  );
  const toggle = (id: number) => {
    if (selectedIds.includes(id)) onChange(selectedIds.filter((x) => x !== id));
    else onChange([...selectedIds, id]);
  };
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      {selectedItems.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selectedItems.map((i) => (
            <span
              key={i.id}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-100 text-blue-800 text-sm"
            >
              {i.name}
              <button
                type="button"
                onClick={() => toggle(i.id)}
                className="text-blue-600 hover:text-blue-800"
                aria-label={`Remove ${i.name}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        type="text"
        placeholder="Search items to add..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onFocus={() => typeahead.setOpen(true)}
        onKeyDown={(e) => {
          const suggestions = typeahead.suggestions;
          if (!suggestions.length) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            typeahead.setActiveIndex(Math.min(typeahead.activeIndex + 1, suggestions.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            typeahead.setActiveIndex(Math.max(typeahead.activeIndex - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const opt = suggestions[typeahead.activeIndex];
            if (opt?.label) setSearch(opt.label);
            typeahead.setOpen(false);
          } else if (e.key === 'Escape') {
            typeahead.setOpen(false);
          }
        }}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 mb-2"
      />
      <div className="relative">
        <TypeaheadDropdown
          open={typeahead.open && search.trim().length >= 2}
          suggestions={typeahead.suggestions}
          activeIndex={typeahead.activeIndex}
          onHoverIndex={typeahead.setActiveIndex}
          onSelect={(opt) => {
            setSearch(opt.label);
            typeahead.setOpen(false);
          }}
          onClose={() => typeahead.setOpen(false)}
        />
      </div>
      <div className="max-h-40 overflow-y-auto rounded border border-gray-200 bg-gray-50/50 p-2 space-y-1">
        {filtered.map((i) => (
          <label
            key={i.id}
            className="flex items-center gap-2 cursor-pointer hover:bg-white rounded px-2 py-1.5 text-sm"
          >
            <input
              type="checkbox"
              checked={selectedIds.includes(i.id)}
              onChange={() => toggle(i.id)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-gray-800">{i.name}</span>
          </label>
        ))}
        {filtered.length === 0 && <p className="text-sm text-gray-400 py-2">No items match</p>}
      </div>
    </div>
  );
}

function SlotEditor({ slot, onChange, onRemove, categories, menuItems }: SlotEditorProps) {
  return (
    <div className="border border-gray-200 rounded-lg p-4 space-y-3 bg-gray-50/50">
      <div className="flex justify-between items-center">
        <select
          value={slot.type}
          onChange={(e) => onChange({ type: e.target.value as DealSlotType })}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium focus:ring-2 focus:ring-blue-500"
        >
          {(Object.keys(DEAL_TYPE_LABELS) as DealSlotType[]).map((t) => (
            <option key={t} value={t}>{DEAL_TYPE_LABELS[t]}</option>
          ))}
        </select>
        <button type="button" onClick={onRemove} className="text-red-600 text-sm font-medium hover:underline">
          Remove slot
        </button>
      </div>
      {slot.type === 'fixed' && (
        <DealFormSearchableSelect
          label="Menu item"
          placeholder="Select item"
          options={menuItems}
          valueId={slot.source_menu_item_id ?? null}
          onChange={(id) => onChange({ source_menu_item_id: id })}
          getOptionId={(o) => o.id}
        />
      )}
      {slot.type === 'choice_category' && (
        <DealFormSearchableSelect
          label="Category"
          placeholder="Select category"
          options={categories}
          valueId={slot.source_category_id ?? null}
          onChange={(id) => onChange({ source_category_id: id })}
          getOptionId={(o) => o.id}
        />
      )}
      {slot.type === 'choice_list' && (
        <SearchableMultiSelect
          label="Items in list (search and tick to add)"
          options={menuItems}
          selectedIds={slot.source_menu_item_ids ?? []}
          onChange={(ids) => onChange({ source_menu_item_ids: ids })}
        />
      )}
      <div className="flex flex-wrap gap-4 items-center pt-1">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-gray-500">Quantity</span>
          <input
            type="number"
            min={1}
            value={slot.quantity}
            onChange={(e) => onChange({ quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })}
            className="w-16 px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
          />
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={slot.allow_customization}
            onChange={(e) => onChange({ allow_customization: e.target.checked })}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          Allow customization
        </label>
      </div>
    </div>
  );
}

export default Deals;

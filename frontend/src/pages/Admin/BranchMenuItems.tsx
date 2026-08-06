import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import { adminService } from '../../services/api/adminService';
import { BranchMenuItem, Branch, MenuItem } from '../../types';
import Loader from '../../components/Loader';
import { formatCurrency } from '../../utils/currency';
import Button from '../../components/Button';
import { useHasPermission } from '../../hooks/useHasPermission';
import ClearFiltersButton from '../../components/ClearFiltersButton';
import SearchableSelect from '../../components/SearchableSelect';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import Card from '../../components/Card';
import Modal from '../../components/Modal';
import PaginationBar, { DEFAULT_PAGE_SIZE } from '../../components/PaginationBar';
import { AccentedList, AccentedListRow } from '../../components/AccentedListRow';
import { confirmDialog } from '../../utils/sweetAlert';
import RecordHistoryLink from '../../components/RecordHistoryLink';

const BranchMenuItems: React.FC = () => {
  const queryClient = useQueryClient();
  const canEdit = useHasPermission('branch-menu:edit');
  const [showForm, setShowForm] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [formData, setFormData] = useState({
    branch_id: '',
    menu_item_id: '',
    price_override: '',
    is_enabled: true,
  });
  const [page, setPage] = useState(1);

  // Fetch branches
  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const response = await apiClient.get<Branch[]>('/admin/branches');
      return response.data;
    },
  });

  // Fetch menu items (all; we filter by selected branch in the modal)
  const { data: menuItems } = useQuery({
    queryKey: ['menuItems'],
    queryFn: async () => {
      const response = await apiClient.get<(MenuItem & { brand_id?: number })[]>('/admin/menu/items');
      return response.data;
    },
  });

  // For "Add Branch Menu Item" modal: only show menu items that belong to the selected branch's brands
  const selectedBranchForForm = formData.branch_id
    ? branches?.find((b) => b.id === parseInt(formData.branch_id, 10))
    : null;
  const branchBrandIds = React.useMemo(
    () => (selectedBranchForForm?.brand_ids?.length ? new Set(selectedBranchForForm.brand_ids) : null),
    [selectedBranchForForm],
  );
  const menuItemsForSelectedBranch = React.useMemo(() => {
    if (!menuItems || !branchBrandIds) return [];
    return menuItems.filter((item) => {
      const bid = (item as MenuItem & { brand_id?: number }).brand_id;
      return bid != null && branchBrandIds.has(bid);
    });
  }, [menuItems, branchBrandIds]);

  // Fetch all branch menu items (then filter by selected branch if any)
  const { data: branchMenuItems, isLoading } = useQuery({
    queryKey: ['branchMenuItems'],
    queryFn: () => adminService.getBranchMenuItems(),
  });

  // Menu items already linked to the branch chosen in the form — these can't be
  // added again (unique branch+item), so we hide them from the picker.
  const linkedMenuItemIds = React.useMemo(() => {
    const branchId = formData.branch_id ? parseInt(formData.branch_id, 10) : null;
    if (branchId == null || !branchMenuItems) return new Set<number>();
    return new Set(
      branchMenuItems
        .filter((bmi) => bmi.branch_id === branchId)
        .map((bmi) => bmi.menu_item_id),
    );
  }, [branchMenuItems, formData.branch_id]);

  // Brand-scoped items minus the ones already added to this branch.
  const addableMenuItems = React.useMemo(
    () => menuItemsForSelectedBranch.filter((item) => !linkedMenuItemIds.has(item.id)),
    [menuItemsForSelectedBranch, linkedMenuItemIds],
  );

  const filteredItems = React.useMemo(() => {
    if (!branchMenuItems) return [];
    let list = selectedBranch == null
      ? branchMenuItems
      : branchMenuItems.filter((item) => item.branch_id === selectedBranch);
    const q = debouncedSearch.trim().toLowerCase();
    if (q) list = list.filter((item) => (item.menu_item?.name || '').toLowerCase().includes(q));
    return list;
  }, [branchMenuItems, selectedBranch, debouncedSearch]);

  const paginatedItems = useMemo(() => {
    const start = (page - 1) * DEFAULT_PAGE_SIZE;
    return filteredItems.slice(start, start + DEFAULT_PAGE_SIZE);
  }, [filteredItems, page]);
  React.useEffect(() => setPage(1), [selectedBranch, debouncedSearch]);

  const createMutation = useMutation({
    mutationFn: adminService.createBranchMenuItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branchMenuItems'] });
      setShowForm(false);
      setFormData({ branch_id: '', menu_item_id: '', price_override: '', is_enabled: true });
      toast.success('Branch menu item created successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to create branch menu item');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<BranchMenuItem> }) =>
      adminService.updateBranchMenuItem(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branchMenuItems'] });
      toast.success('Branch menu item updated successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update branch menu item');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: adminService.deleteBranchMenuItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branchMenuItems'] });
      toast.success('Branch menu item deleted successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to delete branch menu item');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.branch_id) {
      toast.error('Select a branch');
      return;
    }
    if (!formData.menu_item_id) {
      toast.error('Select a menu item');
      return;
    }
    createMutation.mutate({
      branch_id: parseInt(formData.branch_id),
      menu_item_id: parseInt(formData.menu_item_id),
      price_override: formData.price_override ? parseFloat(formData.price_override) : undefined,
      is_enabled: formData.is_enabled,
    });
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;
  if (isLoading || isSubmitting) {
    return <Loader fullScreen text={isSubmitting ? 'Saving...' : 'Loading branch menu items...'} />;
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <h1 className="text-3xl font-bold text-gray-800">Branch Menu Items</h1>
        {canEdit && <Button onClick={() => setShowForm(true)}>
          Add Branch Menu Item
        </Button>}
      </div>

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <SearchableSelect
            label="Filter by Branch"
            value={selectedBranch != null ? String(selectedBranch) : ''}
            onChange={(v) => setSelectedBranch(v ? parseInt(v, 10) : null)}
            options={[
              { value: '', label: 'All branches' },
              ...(branches ?? []).map((branch) => ({
                value: String(branch.id),
                label: `${branch.name} (${branch.code})`,
              })),
            ]}
            placeholder="All branches"
            searchPlaceholder="Search branches..."
            minWidth="min-w-[200px]"
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Search menu item</label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Menu item name..."
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-w-[200px]"
            />
          </div>
          <ClearFiltersButton onClick={() => { setSelectedBranch(null); setSearch(''); }} />
        </div>
      </Card>

      <Modal isOpen={showForm} onClose={() => setShowForm(false)} title="Add Branch Menu Item" size="medium">
        <form onSubmit={handleSubmit} className="space-y-4">
          <SearchableSelect
            label="Branch *"
            value={formData.branch_id}
            onChange={(v) => setFormData({ ...formData, branch_id: v, menu_item_id: '' })}
            options={[
              { value: '', label: 'Select Branch' },
              ...(branches ?? []).map((branch) => ({
                value: String(branch.id),
                label: `${branch.name} (${branch.code})`,
              })),
            ]}
            placeholder="Select Branch"
            searchPlaceholder="Search branches..."
          />

          <div>
            <SearchableSelect
              label="Menu Item *"
              value={formData.menu_item_id}
              onChange={(v) => setFormData({ ...formData, menu_item_id: v })}
              options={addableMenuItems.map((item) => ({
                value: String(item.id),
                label: `${item.name} (${formatCurrency(item.base_price)})`,
              }))}
              placeholder={formData.branch_id ? 'Select Menu Item' : 'Select Branch first'}
              searchPlaceholder="Search menu items..."
              disabled={!formData.branch_id}
            />
            {formData.branch_id && addableMenuItems.length === 0 && (
              <p className="text-xs text-amber-600 mt-1">
                No menu items available to add for this branch{' '}
                {menuItemsForSelectedBranch.length > 0 ? '(all already added).' : '(this branch has no brand menu items).'}
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Price Override (Optional)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={formData.price_override}
              onChange={(e) => setFormData({ ...formData, price_override: e.target.value })}
              placeholder="Leave empty to use base price"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">Override the base price for this branch</p>
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="is_enabled"
              checked={formData.is_enabled}
              onChange={(e) => setFormData({ ...formData, is_enabled: e.target.checked })}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="is_enabled" className="ml-2 text-sm text-gray-700">
              Enabled in this branch
            </label>
          </div>

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={createMutation.isPending}>
              Create
            </Button>
          </div>
        </form>
      </Modal>

      {filteredItems.length === 0 ? (
        <Card className="dark:bg-slate-800 dark:border-slate-700">
          <p className="text-center text-gray-500 dark:text-slate-400 py-12">
            {branchMenuItems?.length === 0
              ? 'No branch menu items yet. Add one above.'
              : debouncedSearch.trim()
                ? 'No menu items match your search.'
                : selectedBranch
                  ? 'No menu items for this branch. Change filter or add one.'
                  : 'No branch menu items yet. Add one above.'}
          </p>
        </Card>
      ) : (
        <>
          <AccentedList>
            {paginatedItems.map((item, i) => {
              const branchName = (item as BranchMenuItem & { branch_name?: string; branch_code?: string }).branch_name;
              const branchCode = (item as BranchMenuItem & { branch_code?: string }).branch_code;
              return (
                <AccentedListRow
                  key={item.id}
                  accent={item.is_enabled ? 'active' : 'inactive'}
                  initial={(item.menu_item?.name || 'M').charAt(0)}
                  title={item.menu_item?.name || 'N/A'}
                  subtitle={
                    <>
                      {branchName && <p>Branch: {branchName}{branchCode ? ` (${branchCode})` : ''}</p>}
                      <p>
                        Base: {formatCurrency(Number(item.menu_item?.base_price ?? 0))}
                        {item.price_override ? ` · Branch: ${formatCurrency(item.price_override)}` : ''}
                      </p>
                    </>
                  }
                  statusLabel={item.is_enabled ? 'Enabled' : 'Disabled'}
                  statusVariant={item.is_enabled ? 'active' : 'inactive'}
                  animationIndex={i}
                  actions={
                    <>
                      {canEdit && <Button size="small" variant="edit" onClick={() => { const newPrice = prompt('Enter new price override (leave empty to use base price):'); if (newPrice !== null) { const trimmed = newPrice.trim(); const value = trimmed === '' ? null : Number.isFinite(parseFloat(trimmed)) ? parseFloat(trimmed) : undefined; if (value !== undefined && value !== null) updateMutation.mutate({ id: item.id, data: { price_override: value } }); else if (trimmed !== '') toast.error('Enter a valid number or leave empty to use base price'); } }} isLoading={updateMutation.isPending}>Edit Price</Button>}
                      <RecordHistoryLink
                        entityType="branch_menu_item"
                        entityId={item.id}
                        label={item.menu_item?.name}
                      />
                      {canEdit && <Button
                        size="small"
                        variant="danger"
                        onClick={() => {
                          (async () => {
                            const ok = await confirmDialog({
                              title: 'Delete this branch menu item?',
                              text: 'This action cannot be undone.',
                              confirmText: 'Delete',
                            });
                            if (!ok) return;
                            deleteMutation.mutate(item.id);
                          })();
                        }}
                        isLoading={deleteMutation.isPending}
                      >
                        Delete
                      </Button>}
                    </>
                  }
                />
              );
            })}
          </AccentedList>
          <PaginationBar totalCount={filteredItems.length} page={page} pageSize={DEFAULT_PAGE_SIZE} onPageChange={setPage} itemLabel="items" />
        </>
      )}
    </div>
  );
};

export default BranchMenuItems;

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import { adminService } from '../../services/api/adminService';
import { BranchMenuItem, Branch, MenuItem } from '../../types';
import Loader from '../../components/Loader';
import { formatCurrency } from '../../utils/currency';
import Button from '../../components/Button';
import ClearFiltersButton from '../../components/ClearFiltersButton';
import Card from '../../components/Card';
import Modal from '../../components/Modal';

const BranchMenuItems: React.FC = () => {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<number | null>(null);
  const [formData, setFormData] = useState({
    branch_id: '',
    menu_item_id: '',
    price_override: '',
    is_enabled: true,
  });

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

  const filteredItems = React.useMemo(() => {
    if (!branchMenuItems) return [];
    if (selectedBranch == null) return branchMenuItems;
    return branchMenuItems.filter((item) => item.branch_id === selectedBranch);
  }, [branchMenuItems, selectedBranch]);

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
    createMutation.mutate({
      branch_id: parseInt(formData.branch_id),
      menu_item_id: parseInt(formData.menu_item_id),
      price_override: formData.price_override ? parseFloat(formData.price_override) : undefined,
      is_enabled: formData.is_enabled,
    });
  };

  if (isLoading) return <Loader fullScreen text="Loading branch menu items..." />;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-800">Branch Menu Items</h1>
        <Button onClick={() => setShowForm(true)}>
          Add Branch Menu Item
        </Button>
      </div>

      <Card className="mb-4 p-4">
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Filters</h4>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Filter by Branch</label>
            <select
              value={selectedBranch ?? ''}
              onChange={(e) => setSelectedBranch(e.target.value ? parseInt(e.target.value) : null)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-w-[200px]"
            >
              <option value="">All branches</option>
              {branches?.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name} ({branch.code})
                </option>
              ))}
            </select>
          </div>
          <ClearFiltersButton onClick={() => setSelectedBranch(null)} />
        </div>
      </Card>

      <Modal isOpen={showForm} onClose={() => setShowForm(false)} title="Add Branch Menu Item" size="medium">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Branch *</label>
            <select
              value={formData.branch_id}
              onChange={(e) => setFormData({ ...formData, branch_id: e.target.value, menu_item_id: '' })}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select Branch</option>
              {branches?.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name} ({branch.code})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Menu Item *</label>
            <select
              value={formData.menu_item_id}
              onChange={(e) => setFormData({ ...formData, menu_item_id: e.target.value })}
              required
              disabled={!formData.branch_id}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:opacity-60 disabled:bg-gray-100"
            >
              <option value="">
                {formData.branch_id ? 'Select Menu Item' : 'Select Branch first'}
              </option>
              {menuItemsForSelectedBranch.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({formatCurrency(item.base_price)})
                </option>
              ))}
            </select>
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
        <Card>
          <p className="text-center text-gray-500 py-8">
            {branchMenuItems?.length === 0
              ? 'No branch menu items yet. Add one above.'
              : selectedBranch
                ? 'No menu items for this branch. Change filter or add one.'
                : 'No branch menu items yet. Add one above.'}
          </p>
        </Card>
      ) : (
        <div className="grid gap-4">
          {filteredItems.map((item) => (
            <Card key={item.id} hover>
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-800 mb-2">
                    {item.menu_item?.name || 'N/A'}
                  </h3>
                  {(item as BranchMenuItem & { branch_name?: string; branch_code?: string }).branch_name && (
                    <p className="text-xs text-gray-500 mb-1">
                      Branch: {(item as BranchMenuItem & { branch_name?: string; branch_code?: string }).branch_name}
                      {(item as BranchMenuItem & { branch_code?: string }).branch_code && ` (${(item as BranchMenuItem & { branch_code?: string }).branch_code})`}
                    </p>
                  )}
                  <div className="space-y-1 text-sm text-gray-600">
                    <p>
                      Base Price: <span className="font-medium">${item.menu_item?.base_price.toFixed(2) || '0.00'}</span>
                    </p>
                    {item.price_override ? (
                      <p>
                        Branch Price: <span className="font-medium text-green-600">
                          {formatCurrency(item.price_override)}
                        </span>
                      </p>
                    ) : (
                      <p className="text-gray-500">Using base price</p>
                    )}
                    <p>
                      Status: <span className={item.is_enabled ? 'text-green-600' : 'text-red-600'}>
                        {item.is_enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="small"
                    variant="secondary"
                    onClick={() => {
                      const newPrice = prompt('Enter new price override (leave empty to use base price):');
                      if (newPrice !== null) {
                        const trimmed = newPrice.trim();
                        const value =
                          trimmed === ''
                            ? null
                            : Number.isFinite(parseFloat(trimmed))
                              ? parseFloat(trimmed)
                              : undefined;
                        if (value !== undefined && value !== null) {
                          updateMutation.mutate({
                            id: item.id,
                            data: { price_override: value },
                          });
                        } else if (trimmed !== '') {
                          toast.error('Enter a valid number or leave empty to use base price');
                        }
                      }
                    }}
                    isLoading={updateMutation.isPending}
                  >
                    Edit Price
                  </Button>
                  <Button
                    size="small"
                    variant="danger"
                    onClick={() => {
                      if (confirm('Delete this branch menu item?')) {
                        deleteMutation.mutate(item.id);
                      }
                    }}
                    isLoading={deleteMutation.isPending}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default BranchMenuItems;

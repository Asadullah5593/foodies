import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import { adminService } from '../../services/api/adminService';
import { Brand, MenuVariant } from '../../types';
import Loader from '../../components/Loader';
import { formatCurrency } from '../../utils/currency';
import Button from '../../components/Button';
import ClearFiltersButton from '../../components/ClearFiltersButton';
import Card from '../../components/Card';
import Modal from '../../components/Modal';

const MenuVariants: React.FC = () => {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingVariant, setEditingVariant] = useState<Pick<MenuVariant, 'id' | 'menu_item_id' | 'name' | 'price_modifier' | 'is_default'> | null>(null);
  const [selectedMenuItem, setSelectedMenuItem] = useState<number | null>(null);
  const [filterBrandId, setFilterBrandId] = useState<number | null>(null);
  const [searchVariant, setSearchVariant] = useState('');
  const [formData, setFormData] = useState({
    menu_item_id: '',
    name: '',
    price_modifier: '',
    is_default: false,
    sort_order: '0',
  });

  const { data: brands } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const response = await apiClient.get<Brand[]>('/admin/brands');
      return response.data;
    },
  });

  const { data: menuItems } = useQuery({
    queryKey: ['menuItems', filterBrandId],
    queryFn: () =>
      adminService.getMenuItems(filterBrandId != null ? { brand_id: filterBrandId } : undefined),
    enabled: true,
  });

  const { data: variants, isLoading } = useQuery({
    queryKey: ['variants', selectedMenuItem, filterBrandId],
    queryFn: () =>
      adminService.getVariants(selectedMenuItem ?? undefined, filterBrandId ?? undefined),
    enabled: true,
  });

  const filteredVariants = useMemo(() => {
    if (!Array.isArray(variants)) return [];
    if (!searchVariant.trim()) return variants;
    const q = searchVariant.trim().toLowerCase();
    return variants.filter((v) => (v.name || '').toLowerCase().includes(q));
  }, [variants, searchVariant]);

  const prevFilterBrandIdRef = React.useRef<number | null>(filterBrandId);
  React.useEffect(() => {
    if (prevFilterBrandIdRef.current !== filterBrandId) {
      prevFilterBrandIdRef.current = filterBrandId;
      setSelectedMenuItem(null);
    }
  }, [filterBrandId]);

  const createMutation = useMutation({
    mutationFn: adminService.createVariant,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['variants'] });
      setShowForm(false);
      setFormData({
        menu_item_id: '',
        name: '',
        price_modifier: '',
        is_default: false,
        sort_order: '0',
      });
      toast.success('Variant created successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to create variant');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: adminService.deleteVariant,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['variants'] });
      toast.success('Variant deleted successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to delete variant');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name?: string; price_modifier?: number; is_default?: boolean; menu_item_id?: number } }) =>
      adminService.updateVariant(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['variants'] });
      setEditingVariant(null);
      toast.success('Variant updated!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update variant');
    },
  });

  const [editVariantForm, setEditVariantForm] = useState({ menu_item_id: '', name: '', price_modifier: '', is_default: false });
  React.useEffect(() => {
    if (editingVariant) {
      setEditVariantForm({
        menu_item_id: String(editingVariant.menu_item_id ?? ''),
        name: editingVariant.name,
        price_modifier: String(editingVariant.price_modifier ?? 0),
        is_default: editingVariant.is_default ?? false,
      });
    }
  }, [editingVariant]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      menu_item_id: parseInt(formData.menu_item_id),
      name: formData.name,
      price_modifier: parseFloat(formData.price_modifier),
      is_default: formData.is_default,
      sort_order: parseInt(formData.sort_order),
    });
  };

  if (isLoading) return <Loader fullScreen text="Loading variants..." />;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-800">Menu Variants</h1>
        <Button onClick={() => setShowForm(true)}>Add Variant</Button>
      </div>

      <Card className="mb-4 p-4">
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Filters</h4>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Brand</label>
            <select
              value={filterBrandId ?? ''}
              onChange={(e) => setFilterBrandId(e.target.value ? parseInt(e.target.value) : null)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm min-w-[180px]"
            >
              <option value="">Select brand</option>
              {brands?.map((b: Brand & { tenant_name?: string }) => (
                <option key={b.id} value={b.id}>
                  {b.tenant_name ? `${b.name} (${b.tenant_name})` : b.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Menu Item</label>
            <select
              value={selectedMenuItem || ''}
              onChange={(e) => setSelectedMenuItem(e.target.value ? parseInt(e.target.value) : null)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm min-w-[160px]"
              disabled={!filterBrandId}
            >
              <option value="">Select a menu item</option>
              {menuItems?.map((item: any) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Search variant name</label>
            <input
              type="text"
              value={searchVariant}
              onChange={(e) => setSearchVariant(e.target.value)}
              placeholder="Variant name..."
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm w-48"
            />
          </div>
          <ClearFiltersButton
            onClick={() => {
              setFilterBrandId(null);
              setSelectedMenuItem(null);
              setSearchVariant('');
            }}
          />
        </div>
      </Card>

      <Modal isOpen={showForm} onClose={() => setShowForm(false)} title="Create Variant" size="medium">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Menu Item *</label>
            <select
              value={formData.menu_item_id}
              onChange={(e) => setFormData({ ...formData, menu_item_id: e.target.value })}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select Menu Item</option>
              {menuItems?.map((item: any) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Variant Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              placeholder="e.g., Small, Medium, Large"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Price Modifier *</label>
            <input
              type="number"
              step="0.01"
              value={formData.price_modifier}
              onChange={(e) => setFormData({ ...formData, price_modifier: e.target.value })}
              required
              placeholder="0.00"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">Positive for increase, negative for decrease</p>
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="is_default"
              checked={formData.is_default}
              onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="is_default" className="ml-2 text-sm text-gray-700">
              Set as default variant
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Sort Order</label>
            <input
              type="number"
              value={formData.sort_order}
              onChange={(e) => setFormData({ ...formData, sort_order: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={createMutation.isPending}>
              Create Variant
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={!!editingVariant}
        onClose={() => setEditingVariant(null)}
        title={editingVariant ? `Edit variant: ${editingVariant.name}` : 'Edit Variant'}
        size="medium"
      >
        {editingVariant && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              updateMutation.mutate({
                id: editingVariant.id,
                data: {
                  menu_item_id: editVariantForm.menu_item_id ? parseInt(editVariantForm.menu_item_id) : undefined,
                  name: editVariantForm.name.trim(),
                  price_modifier: parseFloat(editVariantForm.price_modifier),
                  is_default: editVariantForm.is_default,
                },
              });
            }}
            className="space-y-4"
          >
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Menu Item (Brand)</label>
              <select
                value={editVariantForm.menu_item_id}
                onChange={(e) => setEditVariantForm((f) => ({ ...f, menu_item_id: e.target.value }))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select menu item</option>
                {menuItems?.map((item: any) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">Changing the menu item moves this variant to another product (and brand).</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Variant Name *</label>
              <input
                type="text"
                value={editVariantForm.name}
                onChange={(e) => setEditVariantForm((f) => ({ ...f, name: e.target.value }))}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Price Modifier *</label>
              <input
                type="number"
                step="0.01"
                value={editVariantForm.price_modifier}
                onChange={(e) => setEditVariantForm((f) => ({ ...f, price_modifier: e.target.value }))}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-center">
              <input
                type="checkbox"
                id="edit_is_default"
                checked={editVariantForm.is_default}
                onChange={(e) => setEditVariantForm((f) => ({ ...f, is_default: e.target.checked }))}
                className="h-4 w-4 text-blue-600 rounded border-gray-300"
              />
              <label htmlFor="edit_is_default" className="ml-2 text-sm text-gray-700">Default variant</label>
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => setEditingVariant(null)}>Cancel</Button>
              <Button type="submit" isLoading={updateMutation.isPending}>Update</Button>
            </div>
          </form>
        )}
      </Modal>

      <div className="grid gap-4">
        {(!filteredVariants || filteredVariants.length === 0) ? (
          <Card>
            <p className="text-center text-gray-500 py-8">No variants found. Adjust filters or create your first variant!</p>
          </Card>
        ) : (
          filteredVariants?.map((variant: any) => {
            const priceMod = Number(variant.priceModifier ?? variant.price_modifier ?? 0);
            const menuItemId = variant.menuItemId ?? variant.menu_item_id;
            const menuItem = menuItems?.find((i: any) => i.id === menuItemId);
            const menuItemName =
              variant.menuItem?.name ??
              (variant as { menu_item_name?: string }).menu_item_name ??
              menuItem?.name ??
              'N/A';
            const brandId = variant.menuItem?.brand_id ?? menuItem?.brand_id;
            const brandName = brandId != null ? (brands?.find((b) => b.id === brandId)?.name ?? `#${brandId}`) : null;
            return (
            <Card key={variant.id} hover>
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-lg font-semibold text-gray-800">{variant.name}</h3>
                    {(variant.is_default ?? variant.isDefault) && (
                      <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded">
                        Default
                      </span>
                    )}
                  </div>
                  {brandName != null && (
                    <p className="text-sm text-gray-600 mb-1">
                      Brand: {brandName}
                    </p>
                  )}
                  <p className="text-sm text-gray-600 mb-1">
                    Menu Item: {menuItemName}
                  </p>
                  <p className="text-sm text-gray-600">
                    Price Modifier: {priceMod >= 0 ? '+' : ''}{formatCurrency(Math.abs(priceMod))}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="small"
                    variant="secondary"
                    onClick={() => setEditingVariant({
                      id: variant.id,
                      menu_item_id: menuItemId,
                      name: variant.name,
                      price_modifier: priceMod,
                      is_default: variant.is_default ?? variant.isDefault ?? false,
                    })}
                  >
                    Edit
                  </Button>
                  <Button
                    size="small"
                    variant="danger"
                    onClick={() => {
                      if (confirm(`Delete variant "${variant.name}"?`)) {
                        deleteMutation.mutate(variant.id);
                      }
                    }}
                    isLoading={deleteMutation.isPending}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </Card>
          );
          })
        )}
      </div>
    </div>
  );
};

export default MenuVariants;

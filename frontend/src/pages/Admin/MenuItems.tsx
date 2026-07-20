import React, { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import { adminService } from '../../services/api/adminService';
import Loader from '../../components/Loader';
import { formatCurrency } from '../../utils/currency';
import Button from '../../components/Button';
import ClearFiltersButton from '../../components/ClearFiltersButton';
import SearchableSelect from '../../components/SearchableSelect';
import Card from '../../components/Card';
import Modal from '../../components/Modal';
import PaginationBar, { DEFAULT_PAGE_SIZE } from '../../components/PaginationBar';
import { AccentedList, AccentedListRow } from '../../components/AccentedListRow';
import { getImageFullUrl } from '../../utils/imageUrl';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useTypeaheadSuggestions } from '../../hooks/useTypeaheadSuggestions';
import TypeaheadDropdown from '../../components/TypeaheadDropdown';
import { confirmDialog } from '../../utils/sweetAlert';
import { useHasPermission } from '../../hooks/useHasPermission';

interface MenuItemAddon {
  id: number;
  name: string;
  price: number;
}

interface MenuItem {
  id: number;
  brand_id?: number;
  category_id: number;
  name: string;
  description?: string;
  base_price: number;
  is_active: boolean;
  deal_only?: boolean;
  image_url?: string | null;
  gallery_image_urls?: string[];
  /** Effective channels from API (delivery, pickup, dine_in). */
  available_for_order_types?: string[];
  allergens?: string[] | null;
  calories?: number | null;
  label?: string | null;
  available_time_start?: string | null;
  available_time_end?: string | null;
  available_days_of_week?: number[] | null;
  category?: {
    id: number;
    name: string;
  };
  variants?: { id: number; menu_item_id: number; name: string; price_modifier: number; is_default?: boolean }[];
  addons?: MenuItemAddon[];
  modifier_groups?: { id: number; name: string; modifier_count?: number }[];
}

const ORDER_CHANNELS = [
  { key: 'delivery', label: 'Delivery' },
  { key: 'pickup', label: 'Pickup / Takeaway' },
  { key: 'dine_in', label: 'Dine-in' },
] as const;

const MENU_ITEM_GALLERY_MAX = 12;
/** Must match backend `MAX_UPLOAD_FILE_BYTES` in upload.constants.ts */
const MENU_ITEM_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
const MENU_ITEM_UPLOAD_MAX_MB = 25;

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Parse a comma-separated allergen string into a clean array (null when empty). */
function parseAllergensInput(input: string | undefined): string[] | null {
  if (!input) return null;
  const out = input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return out.length ? out : null;
}

function channelsFromApiList(channels: string[] | undefined | null): {
  delivery: boolean;
  pickup: boolean;
  dine_in: boolean;
} {
  if (!channels?.length) {
    return { delivery: true, pickup: true, dine_in: true };
  }
  return {
    delivery: channels.includes('delivery'),
    pickup: channels.includes('pickup'),
    dine_in: channels.includes('dine_in'),
  };
}

/** Create: omit field when all channels (backend default). Update: send `null` when all channels. */
function buildOrderChannelsPayload(
  ch: { delivery: boolean; pickup: boolean; dine_in: boolean },
  forUpdate: boolean,
): string[] | null | undefined {
  const keys: string[] = [];
  if (ch.delivery) keys.push('delivery');
  if (ch.pickup) keys.push('pickup');
  if (ch.dine_in) keys.push('dine_in');
  if (keys.length === 0) return undefined;
  if (keys.length === 3) return forUpdate ? null : undefined;
  return keys;
}

const MenuItems: React.FC = () => {
  const queryClient = useQueryClient();
  const canCreate = useHasPermission('menu:create');
  const canEdit = useHasPermission('menu:edit');
  const canDelete = useHasPermission('menu:delete');
  const canCreateCategory = useHasPermission('categories:create');
  const [showForm, setShowForm] = useState(false);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [manageAddonsItem, setManageAddonsItem] = useState<MenuItem | null>(null);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [selectedAddonIds, setSelectedAddonIds] = useState<number[]>([]);
  const [categoryFormData, setCategoryFormData] = useState({ brand_id: '', name: '', description: '' });
  const [formData, setFormData] = useState({
    brand_id: '',
    category_id: '',
    name: '',
    description: '',
    base_price: '',
    is_active: true,
    deal_only: false,
    image_url: '',
    gallery_image_urls: [] as string[],
    channel_delivery: true,
    channel_pickup: true,
    channel_dine_in: true,
    allergens: '',
    label: '',
    calories: '',
    available_time_start: '',
    available_time_end: '',
    available_days_of_week: [] as number[],
  });
  const [imageUploading, setImageUploading] = useState(false);
  const [galleryUploading, setGalleryUploading] = useState(false);
  const [editImageUploading, setEditImageUploading] = useState(false);
  const [editGalleryUploading, setEditGalleryUploading] = useState(false);
  const [filters, setFilters] = useState<{
    brand_id: string;
    category_id: string;
    status: string;
    search: string;
  }>({ brand_id: '', category_id: '', status: '', search: '' });
  const debouncedMenuItemSearch = useDebouncedValue(filters.search, 300);
  const [menuItemsPage, setMenuItemsPage] = useState(1);

  const { data: brands } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const response = await apiClient.get<{ id: number; name: string; tenant_name?: string }[]>('/admin/brands');
      return response.data;
    },
  });

  const effectiveBrandId = filters.brand_id ? +filters.brand_id : null;

  const { data: categories } = useQuery({
    queryKey: ['menuCategories', effectiveBrandId],
    queryFn: () => adminService.getCategories(effectiveBrandId != null ? { brand_id: effectiveBrandId } : undefined),
    enabled: true,
  });

  const filterParams = useMemo(() => {
    const p: { brand_id?: number; category_id?: number; is_active?: boolean } = {};
    if (effectiveBrandId != null) p.brand_id = effectiveBrandId;
    if (filters.category_id) p.category_id = +filters.category_id;
    if (filters.status === 'active') p.is_active = true;
    if (filters.status === 'inactive') p.is_active = false;
    return p;
  }, [effectiveBrandId, filters.brand_id, filters.category_id, filters.status]);

  const categoriesForFilter = useMemo(() => categories ?? [], [categories]);

  const formBrandId = formData.brand_id ? +formData.brand_id : null;
  const { data: categoriesForForm } = useQuery({
    queryKey: ['menuCategories', formBrandId],
    queryFn: () => adminService.getCategories(formBrandId != null ? { brand_id: formBrandId } : undefined),
    enabled: !!formBrandId,
  });

  const { data: menuItems, isLoading } = useQuery({
    queryKey: ['menuItems', filterParams],
    queryFn: () => adminService.getMenuItems(Object.keys(filterParams).length ? filterParams : undefined),
    enabled: true,
  });

  const filteredMenuItems = useMemo(() => {
    const items = menuItems ?? [];
    if (!debouncedMenuItemSearch.trim()) return items;
    const q = debouncedMenuItemSearch.trim().toLowerCase();
    return items.filter(
      (item: MenuItem) =>
        (item.name || '').toLowerCase().includes(q) ||
        (item.description || '').toLowerCase().includes(q),
    );
  }, [menuItems, debouncedMenuItemSearch]);

  const paginatedMenuItems = useMemo(() => {
    const start = (menuItemsPage - 1) * DEFAULT_PAGE_SIZE;
    return filteredMenuItems.slice(start, start + DEFAULT_PAGE_SIZE);
  }, [filteredMenuItems, menuItemsPage]);

  useEffect(() => setMenuItemsPage(1), [filters.brand_id, filters.category_id, filters.status, debouncedMenuItemSearch]);

  const menuItemSearchTypeahead = useTypeaheadSuggestions({
    query: debouncedMenuItemSearch,
    options: (menuItems ?? []).map((i: any) => ({ id: String(i.id), label: i.name ?? '' })),
    minChars: 2,
    limit: 8,
  });

  const addonBrandId = manageAddonsItem?.brand_id ?? effectiveBrandId;
  const { data: allAddons } = useQuery({
    queryKey: ['addons', addonBrandId],
    queryFn: () => adminService.getAddons(addonBrandId != null ? { brand_id: addonBrandId } : undefined),
    enabled: !!manageAddonsItem,
  });
  const addonsForItem = useMemo(() => allAddons ?? [], [allAddons]);

  useEffect(() => {
    if (manageAddonsItem) {
      setSelectedAddonIds(manageAddonsItem.addons?.map((a) => a.id) ?? []);
    }
  }, [manageAddonsItem]);

  const prevBrandIdRef = React.useRef<string>(filters.brand_id);
  useEffect(() => {
    if (prevBrandIdRef.current !== filters.brand_id) {
      prevBrandIdRef.current = filters.brand_id;
      setFilters((f) => ({ ...f, category_id: '' }));
    }
  }, [filters.brand_id]);

  const [editFormData, setEditFormData] = useState({
    brand_id: '',
    category_id: '',
    name: '',
    description: '',
    base_price: '',
    is_active: true,
    deal_only: false,
    image_url: '',
    gallery_image_urls: [] as string[],
    channel_delivery: true,
    channel_pickup: true,
    channel_dine_in: true,
    allergens: '',
    label: '',
    calories: '',
    available_time_start: '',
    available_time_end: '',
    available_days_of_week: [] as number[],
  });
  useEffect(() => {
    if (editingItem) {
      const ch = channelsFromApiList(editingItem.available_for_order_types);
      setEditFormData({
        brand_id: editingItem.brand_id != null ? String(editingItem.brand_id) : '',
        category_id: editingItem.category_id != null ? String(editingItem.category_id) : '',
        name: editingItem.name,
        description: editingItem.description ?? '',
        base_price: String(editingItem.base_price),
        is_active: editingItem.is_active,
        deal_only: (editingItem as { deal_only?: boolean }).deal_only ?? false,
        image_url: (editingItem as { image_url?: string }).image_url ?? '',
        gallery_image_urls: [...(editingItem.gallery_image_urls ?? [])],
        channel_delivery: ch.delivery,
        channel_pickup: ch.pickup,
        channel_dine_in: ch.dine_in,
        allergens: (editingItem.allergens ?? []).join(', '),
        label: editingItem.label ?? '',
        calories: editingItem.calories != null ? String(editingItem.calories) : '',
        available_time_start: editingItem.available_time_start ?? '',
        available_time_end: editingItem.available_time_end ?? '',
        available_days_of_week: editingItem.available_days_of_week ?? [],
      });
    }
  }, [editingItem]);

  const editFormBrandId = editingItem && editFormData.brand_id ? +editFormData.brand_id : null;
  const { data: categoriesForEdit } = useQuery({
    queryKey: ['menuCategories', editFormBrandId],
    queryFn: () => adminService.getCategories(editFormBrandId != null ? { brand_id: editFormBrandId } : undefined),
    enabled: !!editingItem && editFormBrandId != null,
  });

  const linkAddonsMutation = useMutation({
    mutationFn: ({ menuItemId, addonIds }: { menuItemId: number; addonIds: number[] }) =>
      adminService.linkAddons(menuItemId, addonIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menuItems'] });
      setManageAddonsItem(null);
      toast.success('Addons updated for this item. They will now appear in the POS when adding this product.');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update addons');
    },
  });

  const updateItemMutation = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: number;
      data: {
        name: string;
        description?: string;
        base_price: number;
        is_active: boolean;
        brand_id?: number;
        category_id?: number;
        image_url?: string | null;
        gallery_image_urls?: string[];
        deal_only?: boolean;
        available_for_order_types?: string[] | null;
        allergens?: string[] | null;
        label?: string | null;
        calories?: number | null;
        available_time_start?: string | null;
        available_time_end?: string | null;
        available_days_of_week?: number[] | null;
      };
    }) => adminService.updateMenuItem(id, data),
    onSuccess: (_updated: unknown, variables) => {
      queryClient.setQueryData(['menuItems', filterParams], (prev: MenuItem[] | undefined) => {
        if (!Array.isArray(prev)) return prev;
        return prev.map((item) =>
          item.id === variables.id
            ? {
                ...item,
                ...variables.data,
                image_url: variables.data.image_url ?? item.image_url,
                gallery_image_urls:
                  variables.data.gallery_image_urls ?? item.gallery_image_urls,
              }
            : item,
        );
      });
      queryClient.invalidateQueries({ queryKey: ['menuItems'] });
      setEditingItem(null);
      toast.success('Menu item updated!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update menu item');
    },
  });

  // Inline active/inactive toggle from the row (partial update).
  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      adminService.updateMenuItem(id, { is_active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menuItems'] });
      toast.success('Menu item status updated');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update status');
    },
  });

  const uploadFileToMenuItems = async (file: File): Promise<string> => {
    if (file.size > MENU_ITEM_UPLOAD_MAX_BYTES) {
      throw Object.assign(new Error('File too large'), {
        response: { data: { message: `File too large. Maximum size is ${MENU_ITEM_UPLOAD_MAX_MB} MB.` } },
      });
    }
    const fd = new FormData();
    fd.append('file', file);
    fd.append('folder', 'menu-items');
    const { data } = await apiClient.post<{ url: string }>('/admin/upload', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    if (!data?.url?.trim()) {
      throw new Error('Upload did not return an image URL.');
    }
    return data.url;
  };

  const uploadGalleryFiles = async (files: File[], mode: 'create' | 'edit') => {
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    if (!imageFiles.length) {
      toast.error('Please select image files (PNG, JPEG, GIF, WebP).');
      return;
    }
    const isEdit = mode === 'edit';
    if (isEdit) setEditGalleryUploading(true);
    else setGalleryUploading(true);
    try {
      const uploaded: string[] = [];
      for (const file of imageFiles) {
        uploaded.push(await uploadFileToMenuItems(file));
      }
      if (!uploaded.length) return;

      // Read current list synchronously from state ref to compute count BEFORE update
      const setter = isEdit ? setEditFormData : setFormData;
      let addedCount = 0;
      setter((prev) => {
        const existing = prev.gallery_image_urls ?? [];
        const next = [...existing];
        for (const url of uploaded) {
          const u = url.trim();
          if (!u || next.includes(u)) continue;
          if (next.length >= MENU_ITEM_GALLERY_MAX) break;
          next.push(u);
          addedCount++;
        }
        return addedCount > 0 ? { ...prev, gallery_image_urls: next } : prev;
      });

      // Use setTimeout so addedCount is finalised after the setter runs
      setTimeout(() => {
        if (addedCount > 0) {
          toast.success(addedCount === 1 ? 'Gallery image added.' : `${addedCount} gallery images added.`);
        } else {
          toast.error(`Gallery is full (max ${MENU_ITEM_GALLERY_MAX}) or these images are already listed.`);
        }
      }, 0);
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Upload failed.');
    } finally {
      if (isEdit) setEditGalleryUploading(false);
      else setGalleryUploading(false);
    }
  };

  const uploadMenuItemImage = async (
    file: File,
    ctx: { mode: 'create' | 'edit'; target: 'main' | 'gallery' },
  ): Promise<boolean> => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file (PNG, JPEG, GIF, WebP).');
      return false;
    }
    const isEdit = ctx.mode === 'edit';
    if (ctx.target === 'main') {
      if (isEdit) setEditImageUploading(true);
      else setImageUploading(true);
      try {
        const url = await uploadFileToMenuItems(file);
        if (isEdit) setEditFormData((prev) => ({ ...prev, image_url: url }));
        else setFormData((prev) => ({ ...prev, image_url: url }));
        toast.success('Main image uploaded.');
        return true;
      } catch (err: unknown) {
        toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Upload failed.');
        return false;
      } finally {
        if (isEdit) setEditImageUploading(false);
        else setImageUploading(false);
      }
    }
    await uploadGalleryFiles([file], ctx.mode);
    return true;
  };

  const handleMainImageInput = (e: React.ChangeEvent<HTMLInputElement>, mode: 'create' | 'edit') => {
    const file = e.target.files?.[0];
    if (file) void uploadMenuItemImage(file, { mode, target: 'main' });
    e.target.value = '';
  };

  const handleGalleryImageInput = (e: React.ChangeEvent<HTMLInputElement>, mode: 'create' | 'edit') => {
    const files = e.target.files;
    if (files?.length) void uploadGalleryFiles(Array.from(files), mode);
    e.target.value = '';
  };

  const createMutation = useMutation({
    mutationFn: async (data: {
      brand_id: string;
      category_id: string;
      name: string;
      description?: string;
      base_price: string;
      is_active: boolean;
      deal_only?: boolean;
      image_url?: string;
      gallery_image_urls?: string[];
      channel_delivery: boolean;
      channel_pickup: boolean;
      channel_dine_in: boolean;
      allergens?: string;
      label?: string;
      calories?: string;
      available_time_start?: string;
      available_time_end?: string;
      available_days_of_week?: number[];
    }) => {
      if (!data.brand_id || !data.category_id) throw new Error('Select a brand and category');
      const channels = buildOrderChannelsPayload(
        {
          delivery: data.channel_delivery,
          pickup: data.channel_pickup,
          dine_in: data.channel_dine_in,
        },
        false,
      );
      const payload: Record<string, unknown> = {
        brand_id: parseInt(data.brand_id),
        category_id: parseInt(data.category_id),
        name: data.name.trim(),
        description: data.description?.trim() || undefined,
        base_price: parseFloat(data.base_price),
        is_active: data.is_active,
        deal_only: data.deal_only ?? false,
        image_url: data.image_url || undefined,
        allergens: parseAllergensInput(data.allergens),
        label: data.label?.trim() || null,
        calories: data.calories?.trim() ? parseInt(data.calories, 10) : null,
        available_time_start: data.available_time_start || null,
        available_time_end: data.available_time_end || null,
        available_days_of_week: data.available_days_of_week?.length ? data.available_days_of_week : null,
      };
      if (data.gallery_image_urls?.length) {
        payload.gallery_image_urls = data.gallery_image_urls;
      }
      if (channels !== undefined) payload.available_for_order_types = channels;
      const response = await apiClient.post('/admin/menu/items', payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menuItems'] });
      queryClient.invalidateQueries({ queryKey: ['menuCategories'] });
      setShowForm(false);
      setFormData({
        brand_id: '',
        category_id: '',
        name: '',
        description: '',
        base_price: '',
        is_active: true,
        deal_only: false,
        image_url: '',
        gallery_image_urls: [] as string[],
        channel_delivery: true,
        channel_pickup: true,
        channel_dine_in: true,
        allergens: '',
        label: '',
        calories: '',
        available_time_start: '',
        available_time_end: '',
        available_days_of_week: [] as number[],
      });
      toast.success('Menu item created successfully!');
    },
    onError: (error: any) => {
      console.error('Error creating menu item:', error);
      console.error('Error response:', error.response?.data);
      
      let errorMessage = 'Failed to create menu item';
      
      if (error.response?.data?.errors) {
        const validationErrors = Object.entries(error.response.data.errors)
          .map(([field, messages]: [string, any]) => `${field}: ${messages.join(', ')}`)
          .join('\n');
        errorMessage = `Validation errors:\n${validationErrors}`;
        console.error('Validation errors:', error.response.data.errors);
      } else if (error.response?.data?.message) {
        errorMessage = error.response.data.message;
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      toast.error(errorMessage);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiClient.delete(`/admin/menu/items/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menuItems'] });
      toast.success('Menu item deleted successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to delete menu item');
    },
  });

  const createCategoryMutation = useMutation({
    mutationFn: async (data: { brand_id: string; name: string; description?: string }) => {
      if (!data.brand_id) throw new Error('Select a brand first');
      const response = await apiClient.post('/admin/menu/categories', {
        brand_id: parseInt(data.brand_id),
        name: data.name,
        description: data.description || null,
        is_active: true,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['menuCategories'] });
      queryClient.invalidateQueries({ queryKey: ['menuItems'] });
      setShowCategoryForm(false);
      setCategoryFormData({ brand_id: '', name: '', description: '' });
      toast.success('Category created successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to create category');
    },
  });

  const isSubmitting =
    createMutation.isPending ||
    updateItemMutation.isPending ||
    deleteMutation.isPending ||
    createCategoryMutation.isPending ||
    linkAddonsMutation.isPending;
  if (isLoading || isSubmitting) {
    return <Loader fullScreen text={isSubmitting ? 'Saving...' : 'Loading menu items...'} />;
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-slate-100">Menu Items</h1>
        <div className="flex gap-2">
          {canCreateCategory && <Button variant="secondary" onClick={() => setShowCategoryForm(true)}>+ New Category</Button>}
          {canCreate && <Button variant="primary" onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancel' : 'Add Menu Item'}</Button>}
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
          <SearchableSelect
            label="Category"
            value={filters.category_id}
            onChange={(v) => setFilters((f) => ({ ...f, category_id: v }))}
            options={[
              { value: '', label: 'All categories' },
              ...categoriesForFilter.map((c: { id: number; name: string }) => ({
                value: String(c.id),
                label: c.name,
              })),
            ]}
            placeholder="All categories"
            minWidth="min-w-[140px]"
          />
          <SearchableSelect
            label="Status"
            value={filters.status}
            onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
            options={[
              { value: '', label: 'All' },
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
            ]}
            placeholder="All"
            minWidth="min-w-[120px]"
          />
          <div className="relative">
            <label className="block text-xs font-medium text-gray-500 mb-1">Search item name</label>
            <input
              type="text"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              onFocus={() => menuItemSearchTypeahead.setOpen(true)}
              onKeyDown={(e) => {
                const suggestions = menuItemSearchTypeahead.suggestions;
                if (!suggestions.length) return;
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  menuItemSearchTypeahead.setActiveIndex(Math.min(menuItemSearchTypeahead.activeIndex + 1, suggestions.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  menuItemSearchTypeahead.setActiveIndex(Math.max(menuItemSearchTypeahead.activeIndex - 1, 0));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  const opt = suggestions[menuItemSearchTypeahead.activeIndex];
                  if (opt?.label) setFilters((f) => ({ ...f, search: opt.label }));
                  menuItemSearchTypeahead.setOpen(false);
                } else if (e.key === 'Escape') {
                  menuItemSearchTypeahead.setOpen(false);
                }
              }}
              placeholder="Item name..."
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm w-48"
            />
            <TypeaheadDropdown
              open={menuItemSearchTypeahead.open && filters.search.trim().length >= 2}
              suggestions={menuItemSearchTypeahead.suggestions}
              activeIndex={menuItemSearchTypeahead.activeIndex}
              onHoverIndex={menuItemSearchTypeahead.setActiveIndex}
              onSelect={(opt) => {
                setFilters((f) => ({ ...f, search: opt.label }));
                menuItemSearchTypeahead.setOpen(false);
              }}
              onClose={() => menuItemSearchTypeahead.setOpen(false)}
            />
          </div>
          <ClearFiltersButton onClick={() => setFilters({ brand_id: '', category_id: '', status: '', search: '' })} />
        </div>
      </Card>

      {showCategoryForm && (
        <Card className="mb-4 bg-blue-50 border-blue-300">
          <div className="flex justify-between items-center mb-2">
            <h4 className="text-lg font-semibold text-gray-800">Create New Category</h4>
            <Button size="small" variant="secondary" onClick={() => {
              setShowCategoryForm(false);
              setCategoryFormData({ brand_id: '', name: '', description: '' });
            }}>
              Cancel
            </Button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!categoryFormData.brand_id) {
                toast.error('Select a brand first');
                return;
              }
              createCategoryMutation.mutate({
                brand_id: categoryFormData.brand_id,
                name: categoryFormData.name,
                description: categoryFormData.description,
              });
            }}
          >
            <div className="mb-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Brand *</label>
              <select
                value={categoryFormData.brand_id}
                onChange={(e) => setCategoryFormData({ ...categoryFormData, brand_id: e.target.value })}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select brand</option>
                {brands?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.tenant_name ? `${b.name} (${b.tenant_name})` : b.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-2">
              <input
                type="text"
                value={categoryFormData.name}
                onChange={(e) => setCategoryFormData({ ...categoryFormData, name: e.target.value })}
                placeholder="Category name (e.g., Appetizers, Main Course)"
                required
                className="col-span-2 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
              <Button type="submit" isLoading={createCategoryMutation.isPending} size="small">
                Create Category
              </Button>
            </div>
            <input
              type="text"
              value={categoryFormData.description}
              onChange={(e) => setCategoryFormData({ ...categoryFormData, description: e.target.value })}
              placeholder="Description (optional)"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </form>
        </Card>
      )}

      <Modal
        isOpen={!!manageAddonsItem}
        onClose={() => {
          setManageAddonsItem(null);
          setSelectedAddonIds([]);
        }}
        title={manageAddonsItem ? `Manage addons: ${manageAddonsItem.name}` : 'Manage addons'}
        size="medium"
      >
        {manageAddonsItem && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Select which addons customers can add to this product in the POS. Only addons from the same tenant are shown.
            </p>
            <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg p-3 space-y-2">
              {addonsForItem.length === 0 ? (
                <p className="text-gray-500 text-sm">No addons available. Create addons in Admin → Menu Addons first.</p>
              ) : (
                addonsForItem.map((addon) => {
                  const checked = selectedAddonIds.includes(addon.id);
                  return (
                    <label key={addon.id} className="flex items-center gap-3 cursor-pointer hover:bg-gray-50 p-2 rounded">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setSelectedAddonIds((prev) =>
                            prev.includes(addon.id) ? prev.filter((id) => id !== addon.id) : [...prev, addon.id]
                          );
                        }}
                        className="h-4 w-4 text-blue-600 rounded border-gray-300"
                      />
                      <span className="font-medium">{addon.name}</span>
                      <span className="text-green-600">{formatCurrency(Number(addon.price ?? 0))}</span>
                    </label>
                  );
                })
              )}
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setManageAddonsItem(null);
                  setSelectedAddonIds([]);
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  linkAddonsMutation.mutate({ menuItemId: manageAddonsItem.id, addonIds: selectedAddonIds });
                }}
                isLoading={linkAddonsMutation.isPending}
              >
                Save addons
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!editingItem}
        onClose={() => setEditingItem(null)}
        title={editingItem ? `Edit: ${editingItem.name}` : 'Edit Menu Item'}
        size="large"
      >
        {editingItem && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!editFormData.brand_id) {
                toast.error('Please select a brand');
                return;
              }
              if (!editFormData.category_id) {
                toast.error('Please select a category');
                return;
              }
              if (!editFormData.name?.trim()) {
                toast.error('Name is required');
                return;
              }
              if (
                !editFormData.channel_delivery &&
                !editFormData.channel_pickup &&
                !editFormData.channel_dine_in
              ) {
                toast.error('Select at least one order type (delivery, pickup, or dine-in)');
                return;
              }
              const basePrice = parseFloat(editFormData.base_price);
              if (isNaN(basePrice) || basePrice < 0) {
                toast.error('Enter a valid price');
                return;
              }
              const av = buildOrderChannelsPayload(
                {
                  delivery: editFormData.channel_delivery,
                  pickup: editFormData.channel_pickup,
                  dine_in: editFormData.channel_dine_in,
                },
                true,
              );
              if (av === undefined) {
                toast.error('Select at least one order type');
                return;
              }
              updateItemMutation.mutate({
                id: editingItem.id,
                data: {
                  brand_id: parseInt(editFormData.brand_id),
                  category_id: parseInt(editFormData.category_id),
                  name: editFormData.name.trim(),
                  description: editFormData.description?.trim() || undefined,
                  base_price: basePrice,
                  is_active: editFormData.is_active,
                  deal_only: editFormData.deal_only,
                  image_url: editFormData.image_url || null,
                  gallery_image_urls: [...editFormData.gallery_image_urls],
                  available_for_order_types: av,
                  allergens: parseAllergensInput(editFormData.allergens),
                  label: editFormData.label.trim() || null,
                  calories: editFormData.calories.trim() ? parseInt(editFormData.calories, 10) : null,
                  available_time_start: editFormData.available_time_start || null,
                  available_time_end: editFormData.available_time_end || null,
                  available_days_of_week: editFormData.available_days_of_week.length ? editFormData.available_days_of_week : null,
                },
              });
            }}
            className="space-y-4"
          >
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Brand *</label>
              <select
                value={editFormData.brand_id}
                onChange={(e) => setEditFormData((f) => ({ ...f, brand_id: e.target.value, category_id: '' }))}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select brand</option>
                {brands?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.tenant_name ? `${b.name} (${b.tenant_name})` : b.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category *</label>
              <select
                value={editFormData.category_id}
                onChange={(e) => setEditFormData((f) => ({ ...f, category_id: e.target.value }))}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select category</option>
                {(categoriesForEdit ?? []).map((c: { id: number; name: string }) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Item Name *</label>
              <input
                type="text"
                value={editFormData.name}
                onChange={(e) => setEditFormData((f) => ({ ...f, name: e.target.value }))}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={editFormData.description}
                onChange={(e) => setEditFormData((f) => ({ ...f, description: e.target.value }))}
                rows={3}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 resize-vertical"
              />
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-3">
              <div>
                <label className="block text-sm font-semibold text-gray-900">Main product image (optional)</label>
                <p className="text-xs text-gray-500 mt-0.5 mb-2">
                  <span className="font-medium text-gray-700">Where it appears:</span> POS menu grid, this admin list thumbnail, and the large hero on the consumer website. One image only.
                </p>
                <p className="text-xs text-gray-500 mb-2">Images are optimized for web on upload (max 1920px wide).</p>
                <input id="edit-item-image-main" type="file" accept="image/*" onChange={(e) => handleMainImageInput(e, 'edit')} disabled={editImageUploading} className="hidden" />
                <div
                  className="border-2 border-dashed border-gray-300 rounded-lg p-4 bg-gray-50/50 transition-colors hover:border-gray-400 hover:bg-gray-50"
                  onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-blue-400', 'bg-blue-50/50'); }}
                  onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('border-blue-400', 'bg-blue-50/50'); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.remove('border-blue-400', 'bg-blue-50/50');
                    const f = e.dataTransfer.files[0];
                    if (f) void uploadMenuItemImage(f, { mode: 'edit', target: 'main' });
                  }}
                >
                  {editFormData.image_url ? (
                    <div className="flex items-start gap-3">
                      <img src={getImageFullUrl(editFormData.image_url)} alt="" className="h-24 w-24 object-cover rounded-lg border border-gray-200 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-600 mb-2">Main image set.</p>
                        <div className="flex gap-2">
                          <Button type="button" size="small" variant="secondary" onClick={() => document.getElementById('edit-item-image-main')?.click()}>
                            Replace
                          </Button>
                          <Button type="button" size="small" variant="outline" onClick={() => setEditFormData((f) => ({ ...f, image_url: '' }))}>
                            Remove
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <label htmlFor="edit-item-image-main" className="flex flex-col items-center justify-center py-6 cursor-pointer text-center">
                      <span className="text-gray-500 text-sm mb-1">PNG, JPEG, GIF or WebP · max {MENU_ITEM_UPLOAD_MAX_MB} MB</span>
                      <span className="text-blue-600 font-medium text-sm">Click to upload or drag and drop</span>
                    </label>
                  )}
                </div>
                {editImageUploading && <p className="text-xs text-amber-600 mt-2 font-medium">Uploading main image…</p>}
              </div>

              <div className="border-t border-gray-200 pt-3">
                <label className="block text-sm font-semibold text-gray-900">Gallery / slider images (optional)</label>
                <p className="text-xs text-gray-500 mt-0.5 mb-2">
                  <span className="font-medium text-gray-700">Where they appear:</span> consumer website only — extra photos in a row or carousel under the main hero.{' '}
                  <span className="font-medium text-gray-700">Not used</span> as the POS tile (POS always uses the main image above).
                </p>
                <p className="text-xs text-gray-500 mb-2">Up to {MENU_ITEM_GALLERY_MAX} images. Order is left-to-right (same as slider order). Optimized on upload (max 1920px).</p>
                <input id="edit-item-gallery" type="file" accept="image/*" multiple onChange={(e) => handleGalleryImageInput(e, 'edit')} disabled={editGalleryUploading} className="hidden" />
                <div className="flex flex-wrap gap-2 mb-2">
                  {editFormData.gallery_image_urls.map((url, idx) => (
                    <div key={`${url}-${idx}`} className="relative group">
                      <img src={getImageFullUrl(url)} alt="" className="h-16 w-16 object-cover rounded-lg border border-gray-200" />
                      <button
                        type="button"
                        className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-600 text-white text-xs leading-none opacity-90 hover:opacity-100"
                        onClick={() =>
                          setEditFormData((f) => ({
                            ...f,
                            gallery_image_urls: f.gallery_image_urls.filter((_, j) => j !== idx),
                          }))
                        }
                        aria-label="Remove gallery image"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <div
                  className="border-2 border-dashed border-gray-300 rounded-lg p-3 bg-gray-50/50 text-center transition-colors hover:border-gray-400"
                  onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-blue-400', 'bg-blue-50/50'); }}
                  onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('border-blue-400', 'bg-blue-50/50'); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.remove('border-blue-400', 'bg-blue-50/50');
                    const fl = e.dataTransfer.files;
                    if (fl?.length) void uploadGalleryFiles(Array.from(fl), 'edit');
                  }}
                >
                  <Button
                    type="button"
                    size="small"
                    variant="secondary"
                    disabled={editGalleryUploading || editFormData.gallery_image_urls.length >= MENU_ITEM_GALLERY_MAX}
                    onClick={() => document.getElementById('edit-item-gallery')?.click()}
                  >
                    Add gallery photos
                  </Button>
                </div>
                {editGalleryUploading && <p className="text-xs text-amber-600 mt-2 font-medium">Uploading gallery…</p>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Price *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editFormData.base_price}
                  onChange={(e) => setEditFormData((f) => ({ ...f, base_price: e.target.value }))}
                  required
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select
                  value={editFormData.is_active ? 'active' : 'inactive'}
                  onChange={(e) => setEditFormData((f) => ({ ...f, is_active: e.target.value === 'active' }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Allergens (comma-separated)</label>
                <input type="text" value={editFormData.allergens}
                  onChange={(e) => setEditFormData((f) => ({ ...f, allergens: e.target.value }))}
                  placeholder="e.g. Gluten, Dairy"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Calories (kcal)</label>
                <input type="number" min="0" value={editFormData.calories}
                  onChange={(e) => setEditFormData((f) => ({ ...f, calories: e.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Label / badge</label>
              <input type="text" value={editFormData.label}
                onChange={(e) => setEditFormData((f) => ({ ...f, label: e.target.value }))}
                placeholder="e.g. Classic, Signature, New"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="rounded-lg border border-gray-200 p-3 space-y-2">
              <p className="text-xs text-gray-500">Available only at certain times (branch timezone) — leave blank for all day.</p>
              <div className="grid grid-cols-2 gap-4">
                <input type="time" value={editFormData.available_time_start}
                  onChange={(e) => setEditFormData((f) => ({ ...f, available_time_start: e.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg" />
                <input type="time" value={editFormData.available_time_end}
                  onChange={(e) => setEditFormData((f) => ({ ...f, available_time_end: e.target.value }))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg" />
              </div>
              <div className="flex flex-wrap gap-2">
                {DAY_LABELS.map((d, i) => {
                  const on = editFormData.available_days_of_week.includes(i);
                  return (
                    <button key={d} type="button"
                      onClick={() => setEditFormData((f) => ({ ...f, available_days_of_week: on ? f.available_days_of_week.filter((x) => x !== i) : [...f.available_days_of_week, i].sort((a, b) => a - b) }))}
                      className={`px-3 py-1 rounded-lg border text-sm ${on ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300 hover:bg-gray-50'}`}>{d}</button>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="edit-deal-only"
                checked={editFormData.deal_only}
                onChange={(e) => setEditFormData((f) => ({ ...f, deal_only: e.target.checked }))}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="edit-deal-only" className="text-sm text-gray-700">
                Deal only (hide from POS as standalone item; use only inside deals)
              </label>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Available for order types</label>
              <p className="text-xs text-gray-500 mb-2">
                Limit where this item can be ordered. Leave all checked for every channel (same as backend default).
              </p>
              <div className="flex flex-wrap gap-4">
                {ORDER_CHANNELS.map((c) => (
                  <label key={c.key} className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={
                        c.key === 'delivery'
                          ? editFormData.channel_delivery
                          : c.key === 'pickup'
                            ? editFormData.channel_pickup
                            : editFormData.channel_dine_in
                      }
                      onChange={(e) => {
                        const checked = e.target.checked;
                        if (c.key === 'delivery') setEditFormData((f) => ({ ...f, channel_delivery: checked }));
                        else if (c.key === 'pickup') setEditFormData((f) => ({ ...f, channel_pickup: checked }));
                        else setEditFormData((f) => ({ ...f, channel_dine_in: checked }));
                      }}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-800">{c.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => setEditingItem(null)}>Cancel</Button>
              <Button type="submit" isLoading={updateItemMutation.isPending}>Update</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal isOpen={showForm} onClose={() => setShowForm(false)} title="Create Menu Item" size="large">
        <form onSubmit={(e) => {
          e.preventDefault();
          if (!formData.brand_id) {
            toast.error('Please select a brand');
            return;
          }
          if (!formData.category_id) {
            toast.error('Please select a category');
            return;
          }
          if (!formData.name || formData.name.trim() === '') {
            toast.error('Please enter an item name');
            return;
          }
          if (!formData.base_price || parseFloat(formData.base_price) <= 0) {
            toast.error('Please enter a valid price');
            return;
          }
          if (
            !formData.channel_delivery &&
            !formData.channel_pickup &&
            !formData.channel_dine_in
          ) {
            toast.error('Select at least one order type (delivery, pickup, or dine-in)');
            return;
          }
          createMutation.mutate({ ...formData, image_url: formData.image_url || undefined });
        }} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Brand *</label>
            <select
              value={formData.brand_id}
              onChange={(e) => setFormData({ ...formData, brand_id: e.target.value, category_id: '' })}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select brand</option>
              {brands?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.tenant_name ? `${b.name} (${b.tenant_name})` : b.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="block text-sm font-medium text-gray-700">Category *</label>
              {canCreateCategory && <Button
                type="button"
                size="small"
                variant="secondary"
                onClick={() => { setShowForm(false); setShowCategoryForm(true); }}
              >
                + New Category
              </Button>}
            </div>
            <select
              value={formData.category_id}
              onChange={(e) => setFormData({ ...formData, category_id: e.target.value })}
              required
              disabled={!formBrandId || !categoriesForForm?.length}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
            >
              <option value="">
                {!formBrandId
                  ? 'Select a brand first'
                  : categoriesForForm?.length === 0
                    ? 'No categories — create one first'
                    : 'Select Category'}
              </option>
              {(categoriesForForm ?? []).map((category: { id: number; name: string }) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Item Name: *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              placeholder="e.g., Margherita Pizza"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description:</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Item description (optional)"
              rows={3}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 resize-vertical"
            />
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-3">
            <div>
              <label className="block text-sm font-semibold text-gray-900">Main product image (optional)</label>
              <p className="text-xs text-gray-500 mt-0.5 mb-2">
                <span className="font-medium text-gray-700">Where it appears:</span> POS menu grid, admin list thumbnail, consumer website hero. One image only.
              </p>
              <p className="text-xs text-gray-500 mb-2">Images are optimized for web on upload (max 1920px wide).</p>
              <input id="create-item-image-main" type="file" accept="image/*" onChange={(e) => handleMainImageInput(e, 'create')} disabled={imageUploading} className="hidden" />
              <div
                className="border-2 border-dashed border-gray-300 rounded-lg p-4 bg-gray-50/50 transition-colors hover:border-gray-400 hover:bg-gray-50"
                onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-blue-400', 'bg-blue-50/50'); }}
                onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('border-blue-400', 'bg-blue-50/50'); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.remove('border-blue-400', 'bg-blue-50/50');
                  const f = e.dataTransfer.files[0];
                  if (f) void uploadMenuItemImage(f, { mode: 'create', target: 'main' });
                }}
              >
                {formData.image_url ? (
                  <div className="flex items-start gap-3">
                    <img src={getImageFullUrl(formData.image_url)} alt="" className="h-24 w-24 object-cover rounded-lg border border-gray-200 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-600 mb-2">Main image set.</p>
                      <div className="flex gap-2">
                        <Button type="button" size="small" variant="secondary" onClick={() => document.getElementById('create-item-image-main')?.click()}>
                          Replace
                        </Button>
                        <Button type="button" size="small" variant="outline" onClick={() => setFormData((p) => ({ ...p, image_url: '' }))}>
                          Remove
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <label htmlFor="create-item-image-main" className="flex flex-col items-center justify-center py-6 cursor-pointer text-center">
                    <span className="text-gray-500 text-sm mb-1">PNG, JPEG, GIF or WebP · max {MENU_ITEM_UPLOAD_MAX_MB} MB</span>
                    <span className="text-blue-600 font-medium text-sm">Click to upload or drag and drop</span>
                  </label>
                )}
              </div>
              {imageUploading && <p className="text-xs text-amber-600 mt-2 font-medium">Uploading main image…</p>}
            </div>

            <div className="border-t border-gray-200 pt-3">
              <label className="block text-sm font-semibold text-gray-900">Gallery / slider images (optional)</label>
              <p className="text-xs text-gray-500 mt-0.5 mb-2">
                <span className="font-medium text-gray-700">Where they appear:</span> consumer website only — under the main hero.{' '}
                <span className="font-medium text-gray-700">Not used</span> as the POS tile.
              </p>
              <p className="text-xs text-gray-500 mb-2">Up to {MENU_ITEM_GALLERY_MAX} images. Order = slider order. Optimized on upload (max 1920px).</p>
              <input id="create-item-gallery" type="file" accept="image/*" multiple onChange={(e) => handleGalleryImageInput(e, 'create')} disabled={galleryUploading} className="hidden" />
              <div className="flex flex-wrap gap-2 mb-2">
                {formData.gallery_image_urls.map((url, idx) => (
                  <div key={`${url}-${idx}`} className="relative group">
                    <img src={getImageFullUrl(url)} alt="" className="h-16 w-16 object-cover rounded-lg border border-gray-200" />
                    <button
                      type="button"
                      className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-600 text-white text-xs leading-none opacity-90 hover:opacity-100"
                      onClick={() =>
                        setFormData((f) => ({
                          ...f,
                          gallery_image_urls: f.gallery_image_urls.filter((_, j) => j !== idx),
                        }))
                      }
                      aria-label="Remove gallery image"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <div
                className="border-2 border-dashed border-gray-300 rounded-lg p-3 bg-gray-50/50 text-center transition-colors hover:border-gray-400"
                onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-blue-400', 'bg-blue-50/50'); }}
                onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('border-blue-400', 'bg-blue-50/50'); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.remove('border-blue-400', 'bg-blue-50/50');
                  const fl = e.dataTransfer.files;
                  if (fl?.length) void uploadGalleryFiles(Array.from(fl), 'create');
                }}
              >
                <Button
                  type="button"
                  size="small"
                  variant="secondary"
                  disabled={galleryUploading || formData.gallery_image_urls.length >= MENU_ITEM_GALLERY_MAX}
                  onClick={() => document.getElementById('create-item-gallery')?.click()}
                >
                  Add gallery photos
                </Button>
              </div>
              {galleryUploading && <p className="text-xs text-amber-600 mt-2 font-medium">Uploading gallery…</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Price: *</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={formData.base_price}
                onChange={(e) => setFormData({ ...formData, base_price: e.target.value })}
                required
                placeholder="0.00"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status:</label>
              <select
                value={formData.is_active ? 'active' : 'inactive'}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.value === 'active' })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Label / badge</label>
            <input
              type="text"
              value={formData.label}
              onChange={(e) => setFormData({ ...formData, label: e.target.value })}
              placeholder="e.g. Classic, Signature, New"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Allergens (comma-separated)</label>
              <input
                type="text"
                value={formData.allergens}
                onChange={(e) => setFormData({ ...formData, allergens: e.target.value })}
                placeholder="e.g. Gluten, Dairy"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Calories (kcal)</label>
              <input
                type="number"
                min="0"
                value={formData.calories}
                onChange={(e) => setFormData({ ...formData, calories: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="rounded-lg border border-gray-200 p-3 space-y-2">
            <p className="text-xs text-gray-500">Available only at certain times (branch timezone) — leave blank for all day. Used for lunch-only items/deals.</p>
            <div className="grid grid-cols-2 gap-4">
              <input type="time" value={formData.available_time_start}
                onChange={(e) => setFormData({ ...formData, available_time_start: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg" />
              <input type="time" value={formData.available_time_end}
                onChange={(e) => setFormData({ ...formData, available_time_end: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div className="flex flex-wrap gap-2">
              {DAY_LABELS.map((d, i) => {
                const on = formData.available_days_of_week.includes(i);
                return (
                  <button key={d} type="button"
                    onClick={() => setFormData({ ...formData, available_days_of_week: on ? formData.available_days_of_week.filter((x) => x !== i) : [...formData.available_days_of_week, i].sort((a, b) => a - b) })}
                    className={`px-3 py-1 rounded-lg border text-sm ${on ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300 hover:bg-gray-50'}`}>{d}</button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="create-deal-only"
              checked={formData.deal_only}
              onChange={(e) => setFormData({ ...formData, deal_only: e.target.checked })}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="create-deal-only" className="text-sm text-gray-700">
              Deal only (hide from POS as standalone item; use only inside deals)
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Available for order types</label>
            <p className="text-xs text-gray-500 dark:text-slate-400 mb-2">
              Limit where this item can be ordered. All checked = available on delivery, pickup/takeaway, and dine-in.
            </p>
            <div className="flex flex-wrap gap-4">
              {ORDER_CHANNELS.map((c) => (
                <label key={c.key} className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={
                      c.key === 'delivery'
                        ? formData.channel_delivery
                        : c.key === 'pickup'
                          ? formData.channel_pickup
                          : formData.channel_dine_in
                    }
                    onChange={(e) => {
                      const checked = e.target.checked;
                      if (c.key === 'delivery') setFormData((f) => ({ ...f, channel_delivery: checked }));
                      else if (c.key === 'pickup') setFormData((f) => ({ ...f, channel_pickup: checked }));
                      else setFormData((f) => ({ ...f, channel_dine_in: checked }));
                    }}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-800 dark:text-slate-200">{c.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={createMutation.isPending}>
              Create Menu Item
            </Button>
          </div>
        </form>
      </Modal>

      <div className="w-full space-y-3">
        {(!menuItems || menuItems.length === 0) ? (
          <Card className="dark:bg-slate-800 dark:border-slate-700">
            <p className="text-center text-gray-500 dark:text-slate-400 py-12">No menu items found. Create your first menu item above!</p>
          </Card>
        ) : filteredMenuItems.length === 0 ? (
          <Card className="dark:bg-slate-800 dark:border-slate-700">
            <p className="text-center text-gray-500 dark:text-slate-400 py-12">No items match your search. Try a different term.</p>
          </Card>
        ) : (
          <>
            <AccentedList>
              {paginatedMenuItems.map((item: MenuItem, i: number) => {
                const imageUrl = (item as MenuItem & { image_url?: string }).image_url ? getImageFullUrl((item as MenuItem & { image_url?: string }).image_url) : null;
                return (
                  <AccentedListRow
                    key={item.id}
                    accent={item.is_active ? 'active' : 'inactive'}
                    imageUrl={imageUrl}
                    initial={item.name?.charAt(0) ?? 'M'}
                    title={item.name}
                    subtitle={
                      <>
                        {item.description && <p>{item.description}</p>}
                        <p>Category: {item.category?.name || 'N/A'}{item.brand_id != null ? ` · Brand: ${brands?.find((b) => b.id === item.brand_id)?.name ?? `#${item.brand_id}`}` : ''}</p>
                        <p className="text-gray-600 dark:text-slate-400">
                          Order types:{' '}
                          {item.available_for_order_types?.length
                            ? ORDER_CHANNELS.filter((o) =>
                                item.available_for_order_types!.includes(o.key),
                              )
                                .map((o) => o.label)
                                .join(' · ')
                            : 'All (delivery, pickup, dine-in)'}
                        </p>
                        <p>{formatCurrency(item.base_price)}</p>
                        {(() => {
                          const brandQs = item.brand_id != null ? `brand_id=${item.brand_id}` : '';
                          const variantCount = item.variants?.length ?? 0;
                          const addonCount = item.addons?.length ?? 0;
                          const groupCount = item.modifier_groups?.length ?? 0;
                          const modifierCount = (item.modifier_groups ?? []).reduce(
                            (sum, g) => sum + (g.modifier_count ?? 0),
                            0,
                          );
                          const linkClass = 'text-blue-600 dark:text-blue-400 hover:underline';
                          return (
                            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5">
                              <Link className={linkClass} to={`/admin/menu-variants?${[brandQs, `item_id=${item.id}`].filter(Boolean).join('&')}`}>
                                {variantCount} variant{variantCount === 1 ? '' : 's'}
                              </Link>
                              <span className="text-gray-300 dark:text-slate-600">·</span>
                              <Link className={linkClass} to={`/admin/menu-addons${brandQs ? `?${brandQs}` : ''}`}>
                                {addonCount} addon{addonCount === 1 ? '' : 's'}
                              </Link>
                              <span className="text-gray-300 dark:text-slate-600">·</span>
                              <Link className={linkClass} to={`/admin/modifiers${brandQs ? `?${brandQs}` : ''}`}>
                                {groupCount} modifier group{groupCount === 1 ? '' : 's'}
                              </Link>
                              <span className="text-gray-300 dark:text-slate-600">·</span>
                              <Link className={linkClass} to={`/admin/modifiers${brandQs ? `?${brandQs}` : ''}`}>
                                {modifierCount} modifier{modifierCount === 1 ? '' : 's'}
                              </Link>
                            </p>
                          );
                        })()}
                      </>
                    }
                    statusLabel={item.is_active ? 'Active' : 'Inactive'}
                    statusVariant={item.is_active ? 'active' : 'inactive'}
                    animationIndex={i}
                    actions={
                      <>
                        {canEdit && <Button size="small" variant="edit" onClick={() => setEditingItem(item)}>Edit</Button>}
                        {canEdit && <Button
                          size="small"
                          variant={item.is_active ? 'outline' : 'primary'}
                          isLoading={toggleActiveMutation.isPending}
                          onClick={() => toggleActiveMutation.mutate({ id: item.id, is_active: !item.is_active })}
                        >
                          {item.is_active ? 'Set inactive' : 'Set active'}
                        </Button>}
                        {canEdit && <Button size="small" variant="secondary" onClick={() => setManageAddonsItem(item)}>Manage addons</Button>}
                        {canDelete && <Button
                          size="small"
                          variant="danger"
                          onClick={() => {
                            (async () => {
                              const ok = await confirmDialog({
                                title: `Delete "${item.name}"?`,
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
            <PaginationBar totalCount={filteredMenuItems.length} page={menuItemsPage} pageSize={DEFAULT_PAGE_SIZE} onPageChange={setMenuItemsPage} itemLabel="items" />
          </>
        )}
      </div>
    </div>
  );
};

export default MenuItems;

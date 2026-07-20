import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import { Brand, MenuItem } from '../../types';
import Loader from '../../components/Loader';
import { formatCurrency } from '../../utils/currency';
import Button from '../../components/Button';
import Card from '../../components/Card';
import { adminService } from '../../services/api/adminService';
import { useAuth } from '../../contexts/AuthContext';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useTypeaheadSuggestions } from '../../hooks/useTypeaheadSuggestions';
import TypeaheadDropdown from '../../components/TypeaheadDropdown';
import LocationPicker from '../../components/LocationPicker';

const inputClass =
  'w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-red-500/50 dark:focus:ring-red-500/40 focus:border-red-500 dark:focus:border-red-500 transition-colors';
const labelClass = 'block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1.5';

const emptyForm = {
  brand_ids: [] as number[],
  name: '',
  code: '',
  address: '',
  phone: '',
  email: '',
  latitude: '',
  longitude: '',
  timezone: 'Asia/Karachi',
  supports_dine_in: true,
  supports_takeaway: true,
  supports_delivery: false,
  delivery_radius_km: '10',
  is_active: true,
  fbr_enabled: false,
  fbr_pos_id: '',
  fbr_token: '',
  fbr_environment: 'sandbox',
  fbr_pct_code: '',
};

/** Common timezones; the branch's own time gates time-restricted items/deals (e.g. lunch offers). */
const TIMEZONE_OPTIONS = [
  'Asia/Karachi',
  'Asia/Dubai',
  'Asia/Riyadh',
  'Asia/Kolkata',
  'Europe/London',
  'Europe/Amsterdam',
  'Europe/Lisbon',
  'Europe/Istanbul',
  'UTC',
];
// ssh -i ~/Downloads/sera.pem ubuntu@3.148.166.208
// asad@asad:~$ ssh -i ~/Downloads/foodies-dev.pem ubuntu@13.250.34.49

type FormData = typeof emptyForm;

const BranchEdit: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isNew = id === 'new';
  const branchId = isNew ? null : parseInt(id ?? '', 10);

  const [formData, setFormData] = useState<FormData>(emptyForm);
  const [linkedMenuItemIds, setLinkedMenuItemIds] = useState<number[]>([]);
  const [menuItemFilterBrand, setMenuItemFilterBrand] = useState<number | ''>('');
  const [menuItemFilterCategory, setMenuItemFilterCategory] = useState<number | ''>('');
  const [menuItemSearch, setMenuItemSearch] = useState('');
  const debouncedMenuItemSearch = useDebouncedValue(menuItemSearch, 300);
  const [brandsDropdownOpen, setBrandsDropdownOpen] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<number>>(new Set());
  const brandsDropdownRef = useRef<HTMLDivElement>(null);

  const { data: brands } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const response = await apiClient.get('/admin/brands');
      return response.data;
    },
  });

  const { data: branch, isLoading: loadingBranch } = useQuery({
    queryKey: ['branch', branchId],
    queryFn: () => adminService.getBranch(branchId!),
    enabled: branchId != null && !isNaN(branchId),
  });

  // Per-brand online open/close at this branch.
  const { user } = useAuth();
  const isBrandLocked = user?.allowed_brand_ids != null;
  const { data: brandAvailability } = useQuery({
    queryKey: ['branch-brand-availability', branchId],
    queryFn: async () => {
      const res = await apiClient.get<
        { brand_id: number; name: string | null; is_open: boolean; closed_at: string | null }[]
      >(`/admin/branches/${branchId}/brand-availability`);
      return res.data;
    },
    enabled: branchId != null && !isNaN(branchId),
  });

  const toggleBrandOpen = useMutation({
    mutationFn: ({ brandId: bid, is_open }: { brandId: number; is_open: boolean }) =>
      apiClient.patch(`/admin/branches/${branchId}/brands/${bid}/availability`, { is_open }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branch-brand-availability', branchId] });
      toast.success('Brand availability updated');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed to update'),
  });

  const closeAllBrands = useMutation({
    mutationFn: (is_open: boolean) =>
      apiClient.patch(`/admin/branches/${branchId}/brands-availability`, { is_open }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branch-brand-availability', branchId] });
      toast.success('All brands updated');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed to update'),
  });

  // Posts a dummy invoice to FBR with the branch's SAVED credentials.
  const testFbrConnection = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<{ success: boolean; msg: string }>(
        `/admin/fbr/branches/${branchId}/test-connection`,
      );
      return res.data;
    },
    onSuccess: (data) => {
      if (data.success) toast.success(data.msg);
      else toast.error(data.msg);
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'FBR connection test failed'),
  });

  useEffect(() => {
    if (branch) {
      setFormData({
        brand_ids: branch.brand_ids ?? [],
        name: branch.name,
        code: branch.code ?? '',
        address: branch.address || '',
        phone: branch.phone || '',
        email: branch.email || '',
        latitude: branch.latitude != null ? String(branch.latitude) : '',
        longitude: branch.longitude != null ? String(branch.longitude) : '',
        timezone: branch.timezone || 'Asia/Karachi',
        supports_dine_in: branch.supports_dine_in ?? true,
        // Pickup is deprecated; treat legacy branch flag as takeaway.
        supports_takeaway:
          branch.supports_takeaway === true || branch.supports_pickup === true,
        supports_delivery: branch.supports_delivery ?? false,
        delivery_radius_km: branch.delivery_radius_km != null ? String(branch.delivery_radius_km) : '10',
        is_active: branch.is_active ?? true,
        fbr_enabled: branch.fbr_enabled ?? false,
        fbr_pos_id: branch.fbr_pos_id || '',
        fbr_token: branch.fbr_token || '',
        fbr_environment: branch.fbr_environment || 'sandbox',
        fbr_pct_code: branch.fbr_pct_code || '',
      });
    } else if (isNew) {
      setFormData(emptyForm);
    }
  }, [branch, isNew]);

  useEffect(() => {
    const load = async () => {
      if (!branchId) return;
      try {
        const list = await adminService.getBranchMenuItems(branchId);
        const ids = (list ?? [])
          .map((x: { menu_item_id?: number; menuItemId?: number }) => x.menu_item_id ?? x.menuItemId)
          .filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
        setLinkedMenuItemIds(Array.from(new Set(ids)));
      } catch {
        setLinkedMenuItemIds([]);
      }
    };
    load();
  }, [branchId]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (brandsDropdownRef.current && !brandsDropdownRef.current.contains(e.target as Node)) {
        setBrandsDropdownOpen(false);
      }
    };
    if (brandsDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [brandsDropdownOpen]);

  const brandIdsForMenu = formData.brand_ids?.length ? formData.brand_ids : [];
  const { data: brandMenuItems } = useQuery({
    queryKey: ['brandMenuItemsForBranch', brandIdsForMenu],
    queryFn: async () => {
      if (brandIdsForMenu.length === 0) return [];
      const results = await Promise.all(
        brandIdsForMenu.map((brandId) => adminService.getMenuItems({ brand_id: brandId })),
      );
      return results.flat();
    },
    enabled: brandIdsForMenu.length > 0,
  });

  type MenuItemWithMeta = MenuItem & { brand_id?: number | null; category?: { id: number; name: string } | null };
  const filteredMenuItems = React.useMemo(() => {
    const items = (brandMenuItems ?? []) as MenuItemWithMeta[];
    return items.filter((mi) => {
      if (menuItemFilterBrand !== '' && (mi.brand_id ?? null) !== menuItemFilterBrand) return false;
      const catId = mi.category_id ?? mi.category?.id ?? null;
      if (menuItemFilterCategory !== '' && catId !== menuItemFilterCategory) return false;
      if (debouncedMenuItemSearch.trim()) {
        if (!mi.name.toLowerCase().includes(debouncedMenuItemSearch.trim().toLowerCase())) return false;
      }
      return true;
    });
  }, [brandMenuItems, menuItemFilterBrand, menuItemFilterCategory, debouncedMenuItemSearch]);

  const branchMenuItemSearchTypeahead = useTypeaheadSuggestions({
    query: debouncedMenuItemSearch,
    options: ((brandMenuItems ?? []) as MenuItemWithMeta[]).map((mi) => ({ id: String(mi.id), label: mi.name ?? '' })),
    minChars: 2,
    limit: 8,
  });

  const menuItemCategoriesForFilter = React.useMemo(() => {
    const items = (brandMenuItems ?? []) as MenuItemWithMeta[];
    const byBrand = menuItemFilterBrand !== '' ? items.filter((i) => (i.brand_id ?? null) === menuItemFilterBrand) : items;
    const seen = new Map<number, string>();
    byBrand.forEach((mi) => {
      const cid = mi.category_id ?? mi.category?.id ?? 0;
      const cname = mi.category?.name ?? 'Uncategorised';
      if (cid && !seen.has(cid)) seen.set(cid, cname);
    });
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [brandMenuItems, menuItemFilterBrand]);

  const menuItemsGroupedByCategory = React.useMemo(() => {
    const byCat = new Map<number, { name: string; items: MenuItemWithMeta[] }>();
    filteredMenuItems.forEach((mi) => {
      const cid = mi.category_id ?? mi.category?.id ?? 0;
      const cname = mi.category?.name ?? 'Uncategorised';
      if (!byCat.has(cid)) byCat.set(cid, { name: cname, items: [] });
      byCat.get(cid)!.items.push(mi);
    });
    return Array.from(byCat.entries()).map(([id, { name, items }]) => ({ id, name, items }));
  }, [filteredMenuItems]);

  const prevCategoryCountRef = useRef(0);
  useEffect(() => {
    const n = menuItemsGroupedByCategory.length;
    if (n > 0 && prevCategoryCountRef.current === 0) {
      setExpandedCategories(new Set(menuItemsGroupedByCategory.map((c) => c.id)));
    }
    prevCategoryCountRef.current = n;
  }, [menuItemsGroupedByCategory]);

  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const payload: Record<string, unknown> = {
        brand_ids: data.brand_ids,
        name: data.name,
        address: data.address || undefined,
        phone: data.phone || undefined,
        email: data.email || undefined,
        latitude: data.latitude ? +data.latitude : undefined,
        longitude: data.longitude ? +data.longitude : undefined,
        timezone: data.timezone || undefined,
        supports_dine_in: data.supports_dine_in,
        supports_takeaway: data.supports_takeaway,
        supports_delivery: data.supports_delivery,
        delivery_radius_km: data.delivery_radius_km ? +data.delivery_radius_km : 10,
        is_active: data.is_active,
      };
      if (linkedMenuItemIds.length) payload.menu_item_ids = linkedMenuItemIds;
      const response = await apiClient.post('/admin/branches', payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branches'] });
      toast.success('Branch created successfully!');
      navigate('/admin/branches');
    },
    onError: (error: unknown) => {
      toast.error((error as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to create branch');
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id: bid, data }: { id: number; data: FormData }) => {
      const payload: Record<string, unknown> = {
        name: data.name,
        code: data.code,
        address: data.address || undefined,
        phone: data.phone || undefined,
        email: data.email || undefined,
        latitude: data.latitude ? +data.latitude : undefined,
        longitude: data.longitude ? +data.longitude : undefined,
        timezone: data.timezone || undefined,
        supports_dine_in: data.supports_dine_in,
        supports_takeaway: data.supports_takeaway,
        supports_delivery: data.supports_delivery,
        delivery_radius_km: data.delivery_radius_km ? +data.delivery_radius_km : 10,
        is_active: data.is_active,
        fbr_enabled: data.fbr_enabled,
        fbr_pos_id: data.fbr_pos_id.trim() || null,
        fbr_token: data.fbr_token.trim() || null,
        fbr_environment: data.fbr_environment,
        fbr_pct_code: data.fbr_pct_code.trim() || null,
      };
      if (data.brand_ids.length) payload.brand_ids = data.brand_ids;
      payload.menu_item_ids = linkedMenuItemIds;
      const response = await apiClient.put(`/admin/branches/${bid}`, payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branches'] });
      queryClient.invalidateQueries({ queryKey: ['branch', branchId] });
      toast.success('Branch updated successfully!');
      navigate('/admin/branches');
    },
    onError: (error: unknown) => {
      toast.error((error as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to update branch');
    },
  });

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const hasOrderType =
      formData.supports_dine_in ||
      formData.supports_takeaway ||
      formData.supports_delivery;
    if (!hasOrderType) {
      toast.error('At least one order type (Dine-in, Takeaway or Delivery) must be selected.');
      return;
    }
    if (formData.fbr_enabled && (!formData.fbr_pos_id.trim() || !formData.fbr_token.trim())) {
      toast.error('FBR POS ID and token are required to enable FBR for this branch.');
      return;
    }
    if (isNew) {
      createMutation.mutate(formData);
    } else if (branchId) {
      updateMutation.mutate({ id: branchId, data: formData });
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;
  if (!isNew && (branchId == null || isNaN(branchId))) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
        <p className="text-gray-600 dark:text-slate-400">Invalid branch ID.</p>
        <Link to="/admin/branches" className="text-red-600 dark:text-red-400 hover:underline mt-2 inline-block">← Back to Branches</Link>
      </div>
    );
  }
  if (!isNew && loadingBranch && !branch) {
    return <Loader fullScreen text="Loading branch..." />;
  }
  if (!isNew && branchId && !branch && !loadingBranch) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
        <p className="text-gray-600 dark:text-slate-400">Branch not found.</p>
        <Link to="/admin/branches" className="text-red-600 dark:text-red-400 hover:underline mt-2 inline-block">← Back to Branches</Link>
      </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6 max-w-5xl mx-auto">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <Link to="/admin/branches" className="text-sm text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 mb-2 inline-block">← Back to Branches</Link>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-slate-100">
            {isNew ? 'New Branch' : `Edit Branch${branch ? `: ${branch.name}` : ''}`}
          </h1>
        </div>
        <Button
          type="button"
          variant="primary"
          onClick={handleSubmit}
          disabled={formData.brand_ids.length === 0 || isSubmitting}
          isLoading={isSubmitting}
        >
          {isNew ? 'Create Branch' : 'Save Changes'}
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        <Card className="p-6 dark:bg-slate-800 dark:border-slate-700">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-600 pb-2 mb-4">Identity</h2>
          <div className="relative" ref={brandsDropdownRef}>
            <label className={labelClass}>{isNew ? 'Brands *' : 'Brands'}</label>
            <button
              type="button"
              onClick={() => setBrandsDropdownOpen((o) => !o)}
              className="w-full px-4 py-2.5 text-left border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 focus:ring-2 focus:ring-red-500 flex items-center justify-between gap-2"
            >
              <span className={formData.brand_ids.length ? 'text-gray-800 dark:text-slate-100' : 'text-gray-500 dark:text-slate-400'}>
                {formData.brand_ids.length
                  ? (brands as Brand[])?.filter((b) => formData.brand_ids.includes(b.id)).map((b) => b.name).join(', ') || `${formData.brand_ids.length} selected`
                  : 'Select brands...'}
              </span>
              <svg className={`w-5 h-5 text-gray-400 shrink-0 transition-transform ${brandsDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {brandsDropdownOpen && (
              <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-lg max-h-56 overflow-y-auto">
                {!brands?.length ? (
                  <p className="p-3 text-sm text-gray-500">No brands found.</p>
                ) : (
                  <ul className="py-1">
                    {(brands as Brand[]).map((brand) => {
                      const selected = formData.brand_ids.includes(brand.id);
                      return (
                        <li key={brand.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setFormData((prev) => ({
                                ...prev,
                                brand_ids: selected
                                  ? prev.brand_ids.filter((bid) => bid !== brand.id)
                                  : Array.from(new Set([...prev.brand_ids, brand.id])),
                              }));
                            }}
                            className={`w-full px-4 py-2.5 text-left text-sm flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-slate-700 ${selected ? 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200' : 'text-gray-700 dark:text-slate-200'}`}
                          >
                            <span className={`inline-flex w-4 h-4 shrink-0 rounded border items-center justify-center ${selected ? 'bg-red-600 border-red-600' : 'border-gray-300 dark:border-slate-500'}`}>
                              {selected && <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                            </span>
                            {brand.name}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">Select one or more brands (e.g. food court: multiple brands at one branch).</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            <div>
              <label className={labelClass}>Name *</label>
              <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required className={inputClass} placeholder="Branch name" />
            </div>
            {!isNew ? (
              <div>
                <label className={labelClass}>Code</label>
                <input type="text" value={formData.code} readOnly className="w-full px-4 py-2 border border-gray-200 dark:border-slate-600 rounded-lg bg-gray-50 dark:bg-slate-700 text-gray-600 dark:text-slate-400" title="Branch code is auto-generated" />
              </div>
            ) : (
              <div className="flex items-center text-sm text-gray-500 dark:text-slate-400">Code will be auto-generated when you save.</div>
            )}
          </div>
        </Card>

        <Card className="p-6 dark:bg-slate-800 dark:border-slate-700">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-600 pb-2 mb-4">Contact & location</h2>
          <div className="space-y-4">
            <div>
              <label className={labelClass}>Address</label>
              <input type="text" value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} className={inputClass} placeholder="Street, city" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Phone</label>
                <input type="tel" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Email</label>
                <input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className={inputClass} />
              </div>
            </div>
            <div>
              <label className={labelClass}>Timezone</label>
              <select
                value={formData.timezone}
                onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
                className={inputClass}
              >
                {(TIMEZONE_OPTIONS.includes(formData.timezone) ? TIMEZONE_OPTIONS : [formData.timezone, ...TIMEZONE_OPTIONS]).map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                The branch's local time. Time-restricted items &amp; deals (e.g. lunch offers) go live by this clock.
              </p>
            </div>
            <div>
              <label className={labelClass}>Pin location on map</label>
              <LocationPicker
                latitude={formData.latitude}
                longitude={formData.longitude}
                onChange={(lat, lng) => setFormData((f) => ({ ...f, latitude: lat, longitude: lng }))}
                onAddressResolve={(addr) => setFormData((f) => (f.address ? f : { ...f, address: addr }))}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Latitude</label>
                <input type="number" step="0.0000001" value={formData.latitude} onChange={(e) => setFormData({ ...formData, latitude: e.target.value })} className={inputClass} placeholder="24.8607" />
              </div>
              <div>
                <label className={labelClass}>Longitude</label>
                <input type="number" step="0.0000001" value={formData.longitude} onChange={(e) => setFormData({ ...formData, longitude: e.target.value })} className={inputClass} placeholder="67.0011" />
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-6 dark:bg-slate-800 dark:border-slate-700">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-600 pb-2 mb-4">Order types</h2>
          <div className="space-y-4">
            <div>
              <span className={labelClass}>Supported order types</span>
              <div className="flex flex-wrap gap-4 pt-1">
                <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={formData.supports_dine_in} onChange={(e) => setFormData({ ...formData, supports_dine_in: e.target.checked })} /> Dine-in</label>
                <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={formData.supports_takeaway} onChange={(e) => setFormData({ ...formData, supports_takeaway: e.target.checked })} /> Takeaway</label>
                <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={formData.supports_delivery} onChange={(e) => setFormData({ ...formData, supports_delivery: e.target.checked })} /> Delivery</label>
              </div>
            </div>
            <div>
              <label className={labelClass}>Delivery radius (km)</label>
              <input type="number" step="0.1" min="0" value={formData.delivery_radius_km} onChange={(e) => setFormData({ ...formData, delivery_radius_km: e.target.value })} className={inputClass} />
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                Riders must be within this branch radius for automatic assignment.
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-6 dark:bg-slate-800 dark:border-slate-700">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-600 pb-2 mb-4">Status</h2>
          <div className="space-y-4">
            <div className="flex flex-wrap items-start gap-6">
              <label className="flex items-start gap-2 cursor-pointer max-w-md">
                <input type="checkbox" checked={formData.is_active} onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })} className="mt-1 rounded border-gray-300 dark:border-slate-500 text-red-600 focus:ring-red-500" />
                <span>
                  <span className="text-sm font-medium text-gray-700 dark:text-slate-300">Branch active</span>
                  <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">Master switch for the whole location. When OFF, this branch is hidden from customers and accepts <strong>no orders on any channel — online AND POS</strong>. To pause just one brand's online ordering (without closing the branch or POS), use the per-brand Open/Closed toggles below.</p>
                </span>
              </label>
            </div>
          </div>
        </Card>

        <Card className="p-6 dark:bg-slate-800 dark:border-slate-700">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 dark:border-slate-600 pb-2 mb-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">FBR Integration</h2>
            {!isNew && (
              <Button
                type="button"
                size="small"
                variant="outline"
                onClick={() => testFbrConnection.mutate()}
                isLoading={testFbrConnection.isPending}
                disabled={!branch?.fbr_pos_id || !branch?.fbr_token}
              >
                Test connection
              </Button>
            )}
          </div>
          <div className="space-y-4">
            <label className="flex items-start gap-2 cursor-pointer max-w-2xl">
              <input
                type="checkbox"
                checked={formData.fbr_enabled}
                onChange={(e) => setFormData({ ...formData, fbr_enabled: e.target.checked })}
                className="mt-1 rounded border-gray-300 dark:border-slate-500 text-red-600 focus:ring-red-500"
              />
              <span>
                <span className="text-sm font-medium text-gray-700 dark:text-slate-300">Report sales to FBR</span>
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                  Every POS / app / kiosk order at this branch is reported to FBR and the returned fiscal
                  invoice number + QR prints on the receipt. Sales are <strong>never blocked</strong>: if FBR is
                  unreachable (or this is OFF), receipts reuse the branch's last real FBR number. Turning this
                  off keeps the credentials saved.
                </p>
              </span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>FBR POS ID</label>
                <input
                  type="text"
                  value={formData.fbr_pos_id}
                  onChange={(e) => setFormData({ ...formData, fbr_pos_id: e.target.value })}
                  className={inputClass}
                  placeholder="e.g. 943050"
                />
              </div>
              <div>
                <label className={labelClass}>Environment</label>
                <select
                  value={formData.fbr_environment}
                  onChange={(e) => setFormData({ ...formData, fbr_environment: e.target.value })}
                  className={inputClass}
                >
                  <option value="sandbox">Sandbox (testing)</option>
                  <option value="live">Live (production)</option>
                </select>
              </div>
            </div>
            <div>
              <label className={labelClass}>FBR token</label>
              <textarea
                value={formData.fbr_token}
                onChange={(e) => setFormData({ ...formData, fbr_token: e.target.value })}
                className={inputClass}
                rows={2}
                placeholder="Bearer token issued by FBR for this POS registration"
              />
            </div>
            <div className="max-w-xs">
              <label className={labelClass}>PCT code (optional)</label>
              <input
                type="text"
                value={formData.fbr_pct_code}
                onChange={(e) => setFormData({ ...formData, fbr_pct_code: e.target.value })}
                className={inputClass}
                placeholder="Default: 98211000"
              />
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                Item classification code from your FBR registration. Leave empty for the restaurant default.
              </p>
            </div>
            {!isNew && (
              <p className="text-xs text-gray-500 dark:text-slate-400">
                “Test connection” uses the last <strong>saved</strong> credentials — save changes first.
              </p>
            )}
          </div>
        </Card>

        {!isNew && (
          <Card className="p-6 dark:bg-slate-800 dark:border-slate-700">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 dark:border-slate-600 pb-2 mb-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">Brand online availability</h2>
              {!isBrandLocked && (brandAvailability?.length ?? 0) > 0 && (
                <div className="flex gap-2">
                  <Button type="button" size="small" variant="outline" onClick={() => closeAllBrands.mutate(false)} isLoading={closeAllBrands.isPending}>Close all brands</Button>
                  <Button type="button" size="small" variant="outline" onClick={() => closeAllBrands.mutate(true)} isLoading={closeAllBrands.isPending}>Open all</Button>
                </div>
              )}
            </div>
            <p className="text-xs text-gray-500 dark:text-slate-400 mb-4">Pause a single brand's <strong>online</strong> orders (consumer app/web/kiosk) at this branch. POS is unaffected. This is separate from the branch's Active switch above.</p>
            {!brandAvailability?.length ? (
              <p className="text-sm text-gray-500 dark:text-slate-400 py-2">No brands assigned to this branch.</p>
            ) : (
              <div className="space-y-2">
                {brandAvailability.map((b) => (
                  <div key={b.brand_id} className="flex items-center justify-between gap-3 py-2 border-b border-gray-100 dark:border-slate-700 last:border-0">
                    <span className="text-sm font-medium text-gray-700 dark:text-slate-200">{b.name ?? `Brand ${b.brand_id}`}</span>
                    <div className="flex items-center gap-3">
                      <span className={b.is_open ? 'text-xs font-semibold text-green-600 dark:text-green-400' : 'text-xs font-semibold text-amber-600 dark:text-amber-400'}>
                        {b.is_open ? 'Open' : 'Closed'}
                      </span>
                      <Button type="button" size="small" variant={b.is_open ? 'danger' : 'primary'} onClick={() => toggleBrandOpen.mutate({ brandId: b.brand_id, is_open: !b.is_open })} isLoading={toggleBrandOpen.isPending}>
                        {b.is_open ? 'Close' : 'Open'}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        <Card className="p-6 dark:bg-slate-800 dark:border-slate-700">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-600 pb-2 mb-4">Menu items at this branch</h2>
          <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">Choose which items appear in POS and consumer menu for this branch. Only linked items can be sold here.</p>
          {!brandMenuItems?.length ? (
            <p className="text-sm text-gray-500 dark:text-slate-400 py-2">
              {brandIdsForMenu.length === 0 ? 'Select at least one brand above to load menu items.' : 'No menu items found for the selected brands.'}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 mb-4 p-3 rounded-lg bg-gray-50 dark:bg-slate-700/40 border border-gray-200 dark:border-slate-600">
                <span className="text-sm font-medium text-gray-700 dark:text-slate-200">
                  <span className="text-red-600 dark:text-red-400">{linkedMenuItemIds.length}</span>
                  <span className="text-gray-500 dark:text-slate-400"> of {(brandMenuItems ?? []).length} items linked</span>
                </span>
                <span className="text-gray-400 dark:text-slate-500">|</span>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setLinkedMenuItemIds((brandMenuItems ?? []).map((mi: { id: number }) => mi.id))}
                    className="text-xs font-medium text-red-600 dark:text-red-400 hover:underline"
                  >
                    Link all
                  </button>
                  <button
                    type="button"
                    onClick={() => setLinkedMenuItemIds([])}
                    className="text-xs font-medium text-gray-600 dark:text-slate-400 hover:underline"
                  >
                    Unlink all
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mb-3">
                <select
                  value={menuItemFilterBrand === '' ? '' : String(menuItemFilterBrand)}
                  onChange={(e) => { setMenuItemFilterBrand(e.target.value === '' ? '' : parseInt(e.target.value, 10)); setMenuItemFilterCategory(''); }}
                  className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-red-500 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
                >
                  <option value="">All brands</option>
                  {(brands as Brand[])?.filter((b) => formData.brand_ids.includes(b.id)).map((b) => <option key={b.id} value={b.id}>{b.name}</option>) ?? []}
                </select>
                <select
                  value={menuItemFilterCategory === '' ? '' : String(menuItemFilterCategory)}
                  onChange={(e) => setMenuItemFilterCategory(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                  className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-red-500 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
                >
                  <option value="">All categories</option>
                  {menuItemCategoriesForFilter.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <div className="relative">
                  <input
                    type="search"
                    placeholder="Search items..."
                    value={menuItemSearch}
                    onChange={(e) => setMenuItemSearch(e.target.value)}
                    onFocus={() => branchMenuItemSearchTypeahead.setOpen(true)}
                    onKeyDown={(e) => {
                      const suggestions = branchMenuItemSearchTypeahead.suggestions;
                      if (!suggestions.length) return;
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        branchMenuItemSearchTypeahead.setActiveIndex(Math.min(branchMenuItemSearchTypeahead.activeIndex + 1, suggestions.length - 1));
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        branchMenuItemSearchTypeahead.setActiveIndex(Math.max(branchMenuItemSearchTypeahead.activeIndex - 1, 0));
                      } else if (e.key === 'Enter') {
                        e.preventDefault();
                        const opt = suggestions[branchMenuItemSearchTypeahead.activeIndex];
                        if (opt?.label) setMenuItemSearch(opt.label);
                        branchMenuItemSearchTypeahead.setOpen(false);
                      } else if (e.key === 'Escape') {
                        branchMenuItemSearchTypeahead.setOpen(false);
                      }
                    }}
                    className="px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-red-500 min-w-[180px] bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
                  />
                  <TypeaheadDropdown
                    open={branchMenuItemSearchTypeahead.open && menuItemSearch.trim().length >= 2}
                    suggestions={branchMenuItemSearchTypeahead.suggestions}
                    activeIndex={branchMenuItemSearchTypeahead.activeIndex}
                    onHoverIndex={branchMenuItemSearchTypeahead.setActiveIndex}
                    onSelect={(opt) => {
                      setMenuItemSearch(opt.label);
                      branchMenuItemSearchTypeahead.setOpen(false);
                    }}
                    onClose={() => branchMenuItemSearchTypeahead.setOpen(false)}
                  />
                </div>
              </div>
              <div className="flex gap-2 mb-3">
                <Button type="button" size="small" variant="outline" onClick={() => setLinkedMenuItemIds((prev) => Array.from(new Set([...prev, ...filteredMenuItems.map((mi) => mi.id)])))}>Link all shown ({filteredMenuItems.length})</Button>
                <Button type="button" size="small" variant="outline" onClick={() => { const visible = new Set(filteredMenuItems.map((mi) => mi.id)); setLinkedMenuItemIds((prev) => prev.filter((id) => !visible.has(id))); }}>Unlink all shown</Button>
              </div>
              <div className="border border-gray-200 dark:border-slate-600 rounded-lg overflow-hidden bg-gray-50 dark:bg-slate-700/30 max-h-[28rem] overflow-y-auto">
                {filteredMenuItems.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-slate-400 p-4">No items match the current filters.</p>
                ) : (
                  <ul className="divide-y divide-gray-200 dark:divide-slate-600">
                    {menuItemsGroupedByCategory.map(({ id: catId, name: catName, items }) => {
                      const linkedInCat = items.filter((mi) => linkedMenuItemIds.includes(mi.id)).length;
                      const isExpanded = expandedCategories.has(catId);
                      return (
                        <li key={catId} className="bg-white dark:bg-slate-800/50">
                          <button
                            type="button"
                            onClick={() => setExpandedCategories((prev) => { const next = new Set(prev); if (next.has(catId)) next.delete(catId); else next.add(catId); return next; })}
                            className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors"
                          >
                            <span className="font-medium text-gray-800 dark:text-slate-200">{catName}</span>
                            <span className="flex items-center gap-2">
                              <span className="text-xs text-gray-500 dark:text-slate-400">{linkedInCat}/{items.length} linked</span>
                              <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                            </span>
                          </button>
                          {isExpanded && (
                            <div className="px-4 pb-3 pt-0 border-t border-gray-100 dark:border-slate-700">
                              <div className="flex gap-2 mb-2 pt-2">
                                <button type="button" onClick={() => setLinkedMenuItemIds((prev) => Array.from(new Set([...prev, ...items.map((mi) => mi.id)])))} className="text-xs font-medium text-red-600 dark:text-red-400 hover:underline">Link all in category</button>
                                <button type="button" onClick={() => setLinkedMenuItemIds((prev) => prev.filter((id) => !items.some((i) => i.id === id)))} className="text-xs font-medium text-gray-600 dark:text-slate-400 hover:underline">Unlink all in category</button>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                                {items.map((mi) => (
                                  <label key={mi.id} className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/50 rounded px-2 py-1.5 -mx-2">
                                    <input type="checkbox" checked={linkedMenuItemIds.includes(mi.id)} onChange={(e) => setLinkedMenuItemIds((prev) => e.target.checked ? Array.from(new Set([...prev, mi.id])) : prev.filter((x) => x !== mi.id))} className="rounded border-gray-300 dark:border-slate-500 text-red-600 focus:ring-red-500" />
                                    <span className="flex-1 truncate">{mi.name}</span>
                                    <span className="text-gray-500 dark:text-slate-400 text-xs shrink-0">{formatCurrency(Number(mi.base_price))}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </>
          )}
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" isLoading={isSubmitting} disabled={formData.brand_ids.length === 0}>
            {isNew ? 'Create Branch' : 'Save Changes'}
          </Button>
          <Link to="/admin/branches"><Button type="button" variant="outline">Cancel</Button></Link>
        </div>
      </form>
    </div>
  );
};

export default BranchEdit;

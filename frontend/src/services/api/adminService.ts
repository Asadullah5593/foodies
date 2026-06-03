import apiClient from '../../utils/apiClient';
import {
  MenuVariant,
  MenuAddon,
  BranchMenuItem,
  Discount,
  Shift,
  User,
  Order,
  RiderProfile,
  RiderOnDuty,
  RiderCompPlan,
  RiderPayrollRun,
  RiderOpsMetricsSnapshot,
  RiderBreakSession,
} from '../../types';

export interface ModifierGroupResponse {
  id: number;
  brand_id: number;
  name: string;
  min_select: number;
  max_select: number;
  modifiers: { id: number; modifier_group_id: number; name: string; price: number }[];
}
export interface ModifierResponse {
  id: number;
  modifier_group_id: number;
  name: string;
  price: number;
  modifier_group_name?: string;
}

export const adminService = {
  // Categories (brand-scoped; uses dedicated categories module)
  getCategories: async (params?: { brand_id?: number; is_active?: boolean; search?: string; sort?: string; order?: string }) => {
    const search = new URLSearchParams();
    if (params?.brand_id != null) search.append('brand_id', String(params.brand_id));
    if (params?.is_active !== undefined) search.append('is_active', String(params.is_active));
    if (params?.search) search.append('search', params.search);
    if (params?.sort) search.append('sort', params.sort);
    if (params?.order) search.append('order', params.order);
    const query = search.toString();
    const response = await apiClient.get(`/admin/categories${query ? '?' + query : ''}`);
    return response.data;
  },
  getCategory: async (id: number) => {
    const response = await apiClient.get(`/admin/categories/${id}`);
    return response.data;
  },
  createCategory: async (data: { brand_id: number; name: string; is_active?: boolean; sort_order?: number }) => {
    const response = await apiClient.post('/admin/categories', data);
    return response.data;
  },
  updateCategory: async (id: number, data: { name?: string; is_active?: boolean; sort_order?: number }) => {
    const response = await apiClient.put(`/admin/categories/${id}`, data);
    return response.data;
  },
  deleteCategory: async (id: number) => {
    await apiClient.delete(`/admin/categories/${id}`);
  },

  // Menu Items (brand-scoped)
  getMenuItems: async (params?: { brand_id?: number; category_id?: number; is_active?: boolean; search?: string }) => {
    const search = new URLSearchParams();
    if (params?.brand_id != null) search.append('brand_id', String(params.brand_id));
    if (params?.category_id != null) search.append('category_id', String(params.category_id));
    if (params?.is_active !== undefined) search.append('is_active', String(params.is_active));
    if (params?.search) search.append('search', params.search);
    const query = search.toString();
    const response = await apiClient.get(`/admin/menu/items${query ? '?' + query : ''}`);
    return response.data;
  },
  updateMenuItem: async (
    id: number,
    data: {
      name?: string;
      description?: string;
      base_price?: number;
      is_active?: boolean;
      brand_id?: number;
      category_id?: number;
      image_url?: string | null;
      /** Extra photos for consumer gallery; POS uses `image_url` only. */
      gallery_image_urls?: string[] | null;
      deal_only?: boolean;
      /** Subset of delivery, pickup, dine_in. Omit or null = all channels. */
      available_for_order_types?: string[] | null;
    },
  ) => {
    const response = await apiClient.put(`/admin/menu/items/${id}`, data);
    return response.data;
  },

  // Deals (menu items with deal_components)
  getDeals: async (params?: { brand_id?: number }) => {
    const search = new URLSearchParams();
    if (params?.brand_id != null) search.append('brand_id', String(params.brand_id));
    const query = search.toString();
    const response = await apiClient.get(`/admin/menu/deals${query ? '?' + query : ''}`);
    return response.data;
  },
  getDeal: async (menuItemId: number) => {
    const response = await apiClient.get(`/admin/menu/deals/${menuItemId}`);
    return response.data;
  },
  saveDeal: async (menuItemId: number, data: { slots: Array<{ slot_index: number; type: 'fixed' | 'choice_category' | 'choice_list'; source_menu_item_id?: number | null; source_category_id?: number | null; source_menu_item_ids?: number[] | null; quantity: number; allow_customization: boolean }> }) => {
    const response = await apiClient.put(`/admin/menu/deals/${menuItemId}`, data);
    return response.data;
  },
  deleteDeal: async (menuItemId: number) => {
    await apiClient.delete(`/admin/menu/deals/${menuItemId}`);
  },

  // Menu Variants (brand-scoped when no menu_item_id)
  getVariants: async (menuItemId?: number, brandId?: number): Promise<MenuVariant[]> => {
    const search = new URLSearchParams();
    if (menuItemId != null) search.append('menu_item_id', String(menuItemId));
    if (brandId != null) search.append('brand_id', String(brandId));
    const query = search.toString();
    const response = await apiClient.get(`/admin/menu/variants${query ? '?' + query : ''}`);
    return Array.isArray(response.data) ? response.data : [];
  },
  
  createVariant: async (data: Partial<MenuVariant>): Promise<MenuVariant> => {
    const response = await apiClient.post('/admin/menu/variants', data);
    return response.data;
  },
  
  updateVariant: async (id: number, data: Partial<MenuVariant>): Promise<MenuVariant> => {
    const response = await apiClient.put(`/admin/menu/variants/${id}`, data);
    return response.data;
  },
  
  deleteVariant: async (id: number): Promise<void> => {
    await apiClient.delete(`/admin/menu/variants/${id}`);
  },

  // Menu Addons (brand-scoped)
  getAddons: async (params?: { category_id?: number; is_active?: boolean; search?: string; brand_id?: number }): Promise<MenuAddon[]> => {
    const search = new URLSearchParams();
    if (params?.category_id != null) search.append('category_id', String(params.category_id));
    if (params?.is_active !== undefined) search.append('is_active', String(params.is_active));
    if (params?.search) search.append('search', params.search);
    if (params?.brand_id != null) search.append('brand_id', String(params.brand_id));
    const query = search.toString();
    const response = await apiClient.get(`/admin/menu/addons${query ? '?' + query : ''}`);
    return response.data;
  },
  
  createAddon: async (data: Partial<MenuAddon>): Promise<MenuAddon> => {
    const response = await apiClient.post('/admin/menu/addons', data);
    return response.data;
  },
  
  updateAddon: async (id: number, data: Partial<MenuAddon>): Promise<MenuAddon> => {
    const response = await apiClient.put(`/admin/menu/addons/${id}`, data);
    return response.data;
  },
  
  deleteAddon: async (id: number): Promise<void> => {
    await apiClient.delete(`/admin/menu/addons/${id}`);
  },

  // Link addons to menu item
  linkAddons: async (menuItemId: number, addonIds: number[]): Promise<void> => {
    await apiClient.post(`/admin/menu/items/${menuItemId}/link-addons`, { addon_ids: addonIds });
  },

  // Modifier groups (brand-scoped)
  getModifierGroups: async (params?: { brand_id?: number }): Promise<ModifierGroupResponse[]> => {
    const search = new URLSearchParams();
    if (params?.brand_id != null) search.append('brand_id', String(params.brand_id));
    const query = search.toString();
    const response = await apiClient.get(`/admin/menu/modifier-groups${query ? '?' + query : ''}`);
    return response.data;
  },
  createModifierGroup: async (data: { brand_id: number; name: string; min_select?: number; max_select?: number }) => {
    const response = await apiClient.post('/admin/menu/modifier-groups', data);
    return response.data;
  },
  updateModifierGroup: async (id: number, data: { name?: string; min_select?: number; max_select?: number }) => {
    const response = await apiClient.put(`/admin/menu/modifier-groups/${id}`, data);
    return response.data;
  },
  deleteModifierGroup: async (id: number): Promise<void> => {
    await apiClient.delete(`/admin/menu/modifier-groups/${id}`);
  },

  // Modifiers (within a group)
  getModifiers: async (params?: { modifier_group_id?: number; brand_id?: number }): Promise<ModifierResponse[]> => {
    const search = new URLSearchParams();
    if (params?.modifier_group_id != null) search.append('modifier_group_id', String(params.modifier_group_id));
    if (params?.brand_id != null) search.append('brand_id', String(params.brand_id));
    const query = search.toString();
    const response = await apiClient.get(`/admin/menu/modifiers${query ? '?' + query : ''}`);
    return response.data;
  },
  createModifier: async (data: { modifier_group_id: number; name: string; price?: number }) => {
    const response = await apiClient.post('/admin/menu/modifiers', data);
    return response.data;
  },
  updateModifier: async (id: number, data: { name?: string; price?: number }) => {
    const response = await apiClient.put(`/admin/menu/modifiers/${id}`, data);
    return response.data;
  },
  deleteModifier: async (id: number): Promise<void> => {
    await apiClient.delete(`/admin/menu/modifiers/${id}`);
  },

  // Link modifier groups to menu item
  linkModifierGroups: async (menuItemId: number, modifierGroupIds: number[]): Promise<void> => {
    await apiClient.post(`/admin/menu/items/${menuItemId}/link-modifier-groups`, { modifier_group_ids: modifierGroupIds });
  },

  // Branches (single branch for edit page)
  getBranch: async (id: number) => {
    const response = await apiClient.get(`/admin/branches/${id}`);
    return response.data;
  },

  // Branch Menu Items (omit branchId to get all entries; pass branchId to get filtered by branch)
  getBranchMenuItems: async (branchId?: number | null): Promise<BranchMenuItem[]> => {
    const url = branchId != null ? `/admin/branch-menu-items?branch_id=${branchId}` : '/admin/branch-menu-items';
    const response = await apiClient.get(url);
    return response.data;
  },
  
  createBranchMenuItem: async (data: Partial<BranchMenuItem>): Promise<BranchMenuItem> => {
    const response = await apiClient.post('/admin/branch-menu-items', data);
    return response.data;
  },
  
  updateBranchMenuItem: async (id: number, data: Partial<BranchMenuItem>): Promise<BranchMenuItem> => {
    const response = await apiClient.put(`/admin/branch-menu-items/${id}`, data);
    return response.data;
  },
  
  deleteBranchMenuItem: async (id: number): Promise<void> => {
    await apiClient.delete(`/admin/branch-menu-items/${id}`);
  },

  // Branch Users (omit branchId to get all branch-user assignments; pass branchId for one branch)
  getBranchUsers: async (branchId?: number | null): Promise<Array<User & { branch_id?: number; branch_name?: string; branch_code?: string }>> => {
    const url = branchId != null ? `/admin/branches/${branchId}/users` : '/admin/branches/all/users';
    const response = await apiClient.get(url);
    return response.data;
  },
  
  assignBranchUsers: async (branchId: number, userIds: number[], roleId: number): Promise<User[]> => {
    const response = await apiClient.post(`/admin/branches/${branchId}/users`, { user_ids: userIds, role_id: roleId });
    return response.data.users;
  },

  assignBranchUsersWithRoles: async (
    branchId: number,
    assignments: { user_id: number; role_id: number }[],
  ): Promise<User[]> => {
    const response = await apiClient.post(`/admin/branches/${branchId}/users`, { assignments });
    return response.data.users;
  },
  
  removeBranchUser: async (branchId: number, userId: number): Promise<void> => {
    await apiClient.delete(`/admin/branches/${branchId}/users/${userId}`);
  },

  // Discounts
  getDiscounts: async (): Promise<Discount[]> => {
    const response = await apiClient.get('/admin/discounts');
    return response.data;
  },
  
  createDiscount: async (data: Partial<Discount>): Promise<Discount> => {
    const response = await apiClient.post('/admin/discounts', data);
    return response.data;
  },
  
  updateDiscount: async (id: number, data: Partial<Discount>): Promise<Discount> => {
    const response = await apiClient.put(`/admin/discounts/${id}`, data);
    return response.data;
  },
  
  deleteDiscount: async (id: number): Promise<void> => {
    await apiClient.delete(`/admin/discounts/${id}`);
  },

  // Shifts
  getShifts: async (branchId?: number, status?: string): Promise<Shift[]> => {
    const params = new URLSearchParams();
    if (branchId) params.append('branch_id', branchId.toString());
    if (status) params.append('status', status);
    const query = params.toString();
    const response = await apiClient.get(`/admin/shifts${query ? '?' + query : ''}`);
    return response.data;
  },
  
  createShift: async (data: Partial<Shift>): Promise<Shift> => {
    const response = await apiClient.post('/admin/shifts', data);
    return response.data;
  },
  
  closeShift: async (id: number, actualCash: number, notes?: string): Promise<Shift> => {
    const response = await apiClient.post(`/admin/shifts/${id}/close`, {
      actual_cash: actualCash,
      notes,
    });
    return response.data;
  },

  getShift: async (id: number): Promise<Shift> => {
    const response = await apiClient.get(`/admin/shifts/${id}`);
    return response.data;
  },

  // Admin Orders
  getUsers: async (): Promise<User[]> => {
    const response = await apiClient.get<User[]>('/admin/users');
    return response.data ?? [];
  },

  updateUser: async (id: number, data: { name?: string; email?: string; password?: string; phone?: string; status?: string; role_id?: number | null }): Promise<User> => {
    const response = await apiClient.put(`/admin/users/${id}`, data);
    return response.data;
  },

  deleteUser: async (id: number): Promise<void> => {
    await apiClient.delete(`/admin/users/${id}`);
  },

  getOrders: async (params?: { branch_id?: number; status?: string; date_from?: string; date_to?: string; has_rider?: boolean }): Promise<Order[]> => {
    const search = new URLSearchParams();
    if (params?.branch_id) search.append('branch_id', String(params.branch_id));
    if (params?.status) search.append('status', params.status);
    if (params?.date_from) search.append('date_from', params.date_from);
    if (params?.date_to) search.append('date_to', params.date_to);
    if (params?.has_rider) search.append('has_rider', '1');
    const query = search.toString();
    const response = await apiClient.get(`/admin/orders${query ? '?' + query : ''}`);
    return response.data;
  },

  getOrder: async (id: number): Promise<Order> => {
    const response = await apiClient.get(`/admin/orders/${id}`);
    return response.data;
  },

  updateOrderStatus: async (id: number, status: string): Promise<Order> => {
    const response = await apiClient.put(`/admin/orders/${id}/status`, { status });
    return response.data;
  },

  // Riders (for delivery assignment) — includes all-time customer star averages (tenant orders only)
  getRiders: async (): Promise<
    Array<{
      id: number;
      name: string;
      email: string | null;
      phone: string | null;
      rating_average: number | null;
      rating_count: number;
    }>
  > => {
    const response = await apiClient.get('/admin/orders/riders');
    return response.data ?? [];
  },

  assignRider: async (orderId: number, riderId: number): Promise<Order> => {
    const response = await apiClient.put(`/admin/orders/${orderId}/rider`, { rider_id: riderId });
    return response.data;
  },

  changeRider: async (orderId: number, riderId: number): Promise<Order> => {
    const response = await apiClient.put(`/admin/orders/${orderId}/rider/change`, { rider_id: riderId });
    return response.data;
  },

  assignRiderToGroup: async (orderGroupId: string, riderId: number): Promise<{ order_group_id: string; updated_count: number }> => {
    const response = await apiClient.put(`/admin/orders/group/${encodeURIComponent(orderGroupId)}/rider`, { rider_id: riderId });
    return response.data;
  },

  changeRiderForGroup: async (orderGroupId: string, riderId: number): Promise<{ order_group_id: string; updated_count: number }> => {
    const response = await apiClient.put(`/admin/orders/group/${encodeURIComponent(orderGroupId)}/rider/change`, { rider_id: riderId });
    return response.data;
  },

  retryAutoAssignOrder: async (orderId: number): Promise<Order> => {
    const response = await apiClient.post(`/admin/orders/${orderId}/auto-assign`);
    return response.data;
  },

  // Rider HRM
  getRiderProfiles: async (): Promise<RiderProfile[]> => {
    const response = await apiClient.get('/admin/rider-hrm/profiles');
    return response.data ?? [];
  },

  upsertRiderProfile: async (data: {
    user_id: number;
    employment_status?: string;
    salary_type?: string;
    employee_code?: string;
    base_salary?: number;
    default_per_ride_commission?: number;
    max_active_orders?: number;
    min_rating?: number;
    min_timely_rate?: number;
    is_active?: boolean;
    metadata?: Record<string, unknown>;
  }): Promise<RiderProfile> => {
    const response = await apiClient.post('/admin/rider-hrm/profiles', data);
    return response.data;
  },

  getOnDutyRiders: async (branchId?: number): Promise<RiderOnDuty[]> => {
    const params = new URLSearchParams();
    if (branchId != null) params.append('branch_id', String(branchId));
    const query = params.toString();
    const response = await apiClient.get(`/admin/rider-hrm/on-duty${query ? `?${query}` : ''}`);
    return response.data ?? [];
  },

  adminCheckInRider: async (data: {
    rider_user_id: number;
    branch_id: number;
    notes?: string;
  }) => {
    const response = await apiClient.post('/admin/rider-hrm/attendance/check-in', data);
    return response.data;
  },

  adminCheckOutRider: async (data: {
    rider_user_id: number;
    notes?: string;
  }) => {
    const response = await apiClient.post('/admin/rider-hrm/attendance/check-out', data);
    return response.data;
  },

  getRiderBreaks: async (
    riderUserId: number,
    opts?: { from?: string; to?: string; limit?: number },
  ): Promise<RiderBreakSession[]> => {
    const params = new URLSearchParams();
    params.append('rider_user_id', String(riderUserId));
    if (opts?.from) params.append('from', opts.from);
    if (opts?.to) params.append('to', opts.to);
    if (opts?.limit != null) params.append('limit', String(opts.limit));
    const response = await apiClient.get(`/admin/rider-hrm/attendance/breaks?${params.toString()}`);
    return response.data?.items ?? [];
  },

  getRiderCompPlans: async (branchId?: number): Promise<RiderCompPlan[]> => {
    const params = new URLSearchParams();
    if (branchId != null) params.append('branch_id', String(branchId));
    const query = params.toString();
    const response = await apiClient.get(`/admin/rider-hrm/comp-plans${query ? `?${query}` : ''}`);
    return response.data ?? [];
  },

  createRiderCompPlan: async (data: {
    name: string;
    pay_method: string;
    branch_id?: number;
    effective_from?: string;
    effective_to?: string;
    components: Array<{
      component_key: string;
      name: string;
      component_type: string;
      calc_basis: string;
      value: number;
      conditions?: Record<string, unknown>;
      is_enabled?: boolean;
      sort_order?: number;
    }>;
  }): Promise<RiderCompPlan> => {
    const response = await apiClient.post('/admin/rider-hrm/comp-plans', data);
    return response.data;
  },

  activateRiderCompPlan: async (planId: number): Promise<RiderCompPlan> => {
    const response = await apiClient.patch(`/admin/rider-hrm/comp-plans/${planId}/activate`);
    return response.data;
  },

  getPayrollRuns: async (branchId?: number): Promise<RiderPayrollRun[]> => {
    const params = new URLSearchParams();
    if (branchId != null) params.append('branch_id', String(branchId));
    const query = params.toString();
    const response = await apiClient.get(`/admin/rider-hrm/payroll/runs${query ? `?${query}` : ''}`);
    return response.data ?? [];
  },

  runPayroll: async (data: {
    from: string;
    to: string;
    branch_id?: number;
    timely_minutes?: number;
    expected_monthly_minutes?: number;
  }): Promise<RiderPayrollRun> => {
    const response = await apiClient.post('/admin/rider-hrm/payroll/runs', data);
    return response.data;
  },

  reversePayrollRun: async (runId: number): Promise<RiderPayrollRun> => {
    const response = await apiClient.post(`/admin/rider-hrm/payroll/runs/${runId}/reverse`);
    return response.data;
  },

  getRiderOpsMetrics: async (): Promise<RiderOpsMetricsSnapshot> => {
    const response = await apiClient.get('/admin/rider-ops/metrics');
    return response.data;
  },

  // Tenants (for super admin or loyalty settings)
  getTenants: async (): Promise<Array<{ id: number; name: string; slug: string; loyalty_enabled?: boolean }>> => {
    const response = await apiClient.get('/admin/tenants');
    return response.data ?? [];
  },

  getTenant: async (id: number) => {
    const response = await apiClient.get(`/admin/tenants/${id}`);
    return response.data;
  },

  // Business settings (tenant users: get/update their own business details)
  getBusinessSettings: async () => {
    const response = await apiClient.get('/admin/business-settings');
    return response.data;
  },

  updateBusinessSettings: async (data: {
    name?: string;
    legal_name?: string;
    default_tax_rate?: number;
    loyalty_enabled?: boolean;
  }) => {
    const response = await apiClient.put('/admin/business-settings', data);
    return response.data;
  },

  // Loyalty settings (per tenant)
  getLoyaltySettings: async (tenantId: number) => {
    const response = await apiClient.get(`/admin/tenants/${tenantId}/loyalty-settings`);
    return response.data;
  },

  updateLoyaltySettings: async (
    tenantId: number,
    data: {
      loyalty_enabled?: boolean;
      display_name?: string;
      spend_per_point?: number;
      min_order_to_earn?: number;
      cash_value_per_point?: number;
      min_order_to_redeem?: number;
      expiry_period?: number;
      expiry_unit?: 'day' | 'month' | 'year';
    },
  ) => {
    const response = await apiClient.put(`/admin/tenants/${tenantId}/loyalty-settings`, data);
    return response.data;
  },

  // Customers
  getCustomers: async () => {
    const response = await apiClient.get('/admin/customers');
    return response.data ?? [];
  },

  getCustomer: async (id: number) => {
    const response = await apiClient.get(`/admin/customers/${id}`);
    return response.data;
  },

  createCustomer: async (data: { name: string; phone: string }) => {
    const response = await apiClient.post('/admin/customers', data);
    return response.data;
  },

  updateCustomer: async (id: number, data: { name?: string }) => {
    const response = await apiClient.put(`/admin/customers/${id}`, data);
    return response.data;
  },

  deleteCustomer: async (id: number): Promise<void> => {
    await apiClient.delete(`/admin/customers/${id}`);
  },
};

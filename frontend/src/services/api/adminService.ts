import apiClient from '../../utils/apiClient';
import { MenuVariant, MenuAddon, BranchMenuItem, Discount, Shift, User, Order } from '../../types';

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
  updateMenuItem: async (id: number, data: { name?: string; description?: string; base_price?: number; is_active?: boolean; brand_id?: number; category_id?: number }) => {
    const response = await apiClient.put(`/admin/menu/items/${id}`, data);
    return response.data;
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

  updateUser: async (id: number, data: { name?: string; email?: string; password?: string; phone?: string; status?: string; role_id?: number }): Promise<User> => {
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

  // Riders (for delivery assignment)
  getRiders: async (): Promise<Array<{ id: number; name: string; email: string | null; phone: string | null }>> => {
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

  // Tenants (for super admin or loyalty settings)
  getTenants: async (): Promise<Array<{ id: number; name: string; slug: string; loyalty_enabled?: boolean }>> => {
    const response = await apiClient.get('/admin/tenants');
    return response.data ?? [];
  },

  getTenant: async (id: number) => {
    const response = await apiClient.get(`/admin/tenants/${id}`);
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

import apiClient from '../../utils/apiClient';
import {
  MenuVariant,
  MenuAddon,
  BranchMenuItem,
  Discount,
  Banner,
  Promotion,
  CustomerPromotion,
  Campaign,
  CampaignItem,
  CouponVoucher,
  OfferReport,
  OfferSettings,
  Shift,
  ShiftOrdersResponse,
  User,
  Order,
  RiderProfile,
  RiderOnDuty,
  RiderCompPlan,
  RiderPayrollRun,
  RiderOpsMetricsSnapshot,
  RiderBreakSession,
  RiderWithBrands,
  RiderBrandLink,
  RiderShareRequest,
  RiderShareRequestStatus,
  PoolRiderSummary,
} from '../../types';

export interface ModifierGroupResponse {
  id: number;
  brand_id: number;
  name: string;
  min_select: number;
  max_select: number;
  /** Per-size override of min_select, keyed by variant size_key (e.g. {"large":2,"xl":3}). */
  min_select_by_size?: Record<string, number> | null;
  /** Per-size override of max_select, keyed by variant size_key. */
  max_select_by_size?: Record<string, number> | null;
  /** Units in this group included free before any are charged ("first N free"). */
  included_quantity?: number;
  /** Per-size override of included_quantity, keyed by variant size_key (e.g. {"7":2,"12":3}). */
  included_by_size?: Record<string, number> | null;
  /** Allow the same free/optional option to be added multiple times. */
  allow_quantity?: boolean;
  /** Quantity-tiered bundle price for charged units (charged count → total). */
  price_tiers?: Record<string, number> | null;
  sort_order?: number;
  linked_menu_items?: { id: number; name: string }[];
  modifiers: {
    id: number;
    modifier_group_id: number;
    name: string;
    price: number;
    price_by_size?: Record<string, number> | null;
    sort_order?: number;
  }[];
}
export interface ModifierResponse {
  id: number;
  modifier_group_id: number;
  name: string;
  price: number;
  /** Per-size surcharge keyed by variant size_key (e.g. {"7":99,"12":249}); null = use flat price. */
  price_by_size?: Record<string, number> | null;
  sort_order?: number;
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
  createCategory: async (data: { brand_id: number; name: string; is_active?: boolean; sort_order?: number; description?: string | null; image_url?: string | null }) => {
    const response = await apiClient.post('/admin/categories', data);
    return response.data;
  },
  updateCategory: async (id: number, data: { name?: string; is_active?: boolean; sort_order?: number; description?: string | null; image_url?: string | null }) => {
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
  createMenuItem: async (data: {
    brand_id: number;
    category_id: number;
    name: string;
    base_price: number;
    is_active?: boolean;
    deal_only?: boolean;
    description?: string;
  }) => {
    const response = await apiClient.post('/admin/menu/items', data);
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
  saveDeal: async (menuItemId: number, data: { slots: Array<{ slot_index: number; type: 'fixed' | 'choice_category' | 'choice_list'; source_menu_item_id?: number | null; source_category_id?: number | null; source_menu_item_ids?: number[] | null; quantity: number; allow_customization: boolean; slot_surcharges?: Record<string, number> | null }> }) => {
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
  getModifierGroups: async (params?: { brand_id?: number; menu_item_id?: number }): Promise<ModifierGroupResponse[]> => {
    const search = new URLSearchParams();
    if (params?.brand_id != null) search.append('brand_id', String(params.brand_id));
    if (params?.menu_item_id != null) search.append('menu_item_id', String(params.menu_item_id));
    const query = search.toString();
    const response = await apiClient.get(`/admin/menu/modifier-groups${query ? '?' + query : ''}`);
    return response.data;
  },
  createModifierGroup: async (data: { brand_id: number; name: string; min_select?: number; max_select?: number; min_select_by_size?: Record<string, number> | null; max_select_by_size?: Record<string, number> | null; included_quantity?: number; included_by_size?: Record<string, number> | null; allow_quantity?: boolean }) => {
    const response = await apiClient.post('/admin/menu/modifier-groups', data);
    return response.data;
  },
  updateModifierGroup: async (id: number, data: { name?: string; min_select?: number; max_select?: number; min_select_by_size?: Record<string, number> | null; max_select_by_size?: Record<string, number> | null; included_quantity?: number; included_by_size?: Record<string, number> | null; allow_quantity?: boolean }) => {
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
  createModifier: async (data: { modifier_group_id: number; name: string; price?: number; price_by_size?: Record<string, number> | null }) => {
    const response = await apiClient.post('/admin/menu/modifiers', data);
    return response.data;
  },
  updateModifier: async (id: number, data: { name?: string; price?: number; price_by_size?: Record<string, number> | null }) => {
    const response = await apiClient.put(`/admin/menu/modifiers/${id}`, data);
    return response.data;
  },
  deleteModifier: async (id: number): Promise<void> => {
    await apiClient.delete(`/admin/menu/modifiers/${id}`);
  },

  reorderModifiers: async (modifierGroupId: number, orderedIds: number[]): Promise<void> => {
    await apiClient.patch(`/admin/menu/modifier-groups/${modifierGroupId}/reorder`, { ordered_ids: orderedIds });
  },

  reorderModifierGroups: async (brandId: number, orderedIds: number[]): Promise<void> => {
    await apiClient.patch(`/admin/menu/modifier-groups/reorder`, { brand_id: brandId, ordered_ids: orderedIds });
  },

  reorderItemModifierGroups: async (itemId: number, orderedIds: number[]): Promise<void> => {
    await apiClient.patch(`/admin/menu/items/${itemId}/reorder-modifier-groups`, { ordered_ids: orderedIds });
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
  getBranchUsers: async (branchId?: number | null): Promise<Array<User & { branch_id?: number; branch_name?: string; branch_code?: string; brand_id?: number | null; brand_name?: string | null }>> => {
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
    assignments: { user_id: number; role_id: number; brand_id?: number | null }[],
  ): Promise<User[]> => {
    const response = await apiClient.post(`/admin/branches/${branchId}/users`, { assignments });
    return response.data.users;
  },
  
  removeBranchUser: async (branchId: number, userId: number): Promise<void> => {
    await apiClient.delete(`/admin/branches/${branchId}/users/${userId}`);
  },

  bulkAssignUserToBranches: async (payload: {
    user_id: number;
    branch_ids: number[];
    role_id: number;
    brand_id?: number | null;
  }): Promise<{ message: string; assigned_count: number }> => {
    const response = await apiClient.post('/admin/branches/bulk-assign', payload);
    return response.data;
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

  // CMS – Banners
  getBanners: async (): Promise<Banner[]> => {
    const response = await apiClient.get('/admin/banners');
    return response.data;
  },

  createBanner: async (data: Partial<Banner>): Promise<Banner> => {
    const response = await apiClient.post('/admin/banners', data);
    return response.data;
  },

  updateBanner: async (id: number, data: Partial<Banner>): Promise<Banner> => {
    const response = await apiClient.put(`/admin/banners/${id}`, data);
    return response.data;
  },

  deleteBanner: async (id: number): Promise<void> => {
    await apiClient.delete(`/admin/banners/${id}`);
  },

  // Promotions
  getPromotions: async (): Promise<Promotion[]> => {
    const response = await apiClient.get('/admin/promotions');
    return response.data;
  },

  createPromotion: async (data: Partial<Promotion>): Promise<Promotion> => {
    const response = await apiClient.post('/admin/promotions', data);
    return response.data;
  },

  updatePromotion: async (id: number, data: Partial<Promotion>): Promise<Promotion> => {
    const response = await apiClient.put(`/admin/promotions/${id}`, data);
    return response.data;
  },

  deletePromotion: async (id: number): Promise<void> => {
    await apiClient.delete(`/admin/promotions/${id}`);
  },

  getPromotionAssignments: async (promotionId: number): Promise<CustomerPromotion[]> => {
    const response = await apiClient.get(`/admin/promotions/${promotionId}/assignments`);
    return response.data;
  },

  assignPromotion: async (promotionId: number, customerId: number): Promise<CustomerPromotion> => {
    const response = await apiClient.post(`/admin/promotions/${promotionId}/assign`, { customer_id: customerId });
    return response.data;
  },

  // Product Promotions (offer_kind=product_promotion)
  getProductPromotions: async (): Promise<Discount[]> => {
    const r = await apiClient.get('/admin/product-promotions');
    return r.data;
  },
  createProductPromotion: async (data: Partial<Discount>): Promise<Discount> => {
    const r = await apiClient.post('/admin/product-promotions', data);
    return r.data;
  },
  updateProductPromotion: async (id: number, data: Partial<Discount>): Promise<Discount> => {
    const r = await apiClient.put(`/admin/product-promotions/${id}`, data);
    return r.data;
  },
  deleteProductPromotion: async (id: number): Promise<void> => {
    await apiClient.delete(`/admin/product-promotions/${id}`);
  },

  // Invoice templates (selectable invoice schemas + field toggles)
  getInvoiceTemplates: async (): Promise<any[]> => {
    const r = await apiClient.get('/admin/invoice-templates');
    return r.data;
  },
  createInvoiceTemplate: async (data: Record<string, unknown>): Promise<any> => {
    const r = await apiClient.post('/admin/invoice-templates', data);
    return r.data;
  },
  updateInvoiceTemplate: async (id: number, data: Record<string, unknown>): Promise<any> => {
    const r = await apiClient.put(`/admin/invoice-templates/${id}`, data);
    return r.data;
  },
  activateInvoiceTemplate: async (id: number): Promise<any> => {
    const r = await apiClient.put(`/admin/invoice-templates/${id}/activate`, {});
    return r.data;
  },
  deleteInvoiceTemplate: async (id: number): Promise<void> => {
    await apiClient.delete(`/admin/invoice-templates/${id}`);
  },

  // Coupons (offer_kind=coupon) + vouchers + report
  getCoupons: async (): Promise<Discount[]> => {
    const r = await apiClient.get('/admin/coupons');
    return r.data;
  },
  createCoupon: async (data: Partial<Discount>): Promise<Discount> => {
    const r = await apiClient.post('/admin/coupons', data);
    return r.data;
  },
  updateCoupon: async (id: number, data: Partial<Discount>): Promise<Discount> => {
    const r = await apiClient.put(`/admin/coupons/${id}`, data);
    return r.data;
  },
  deleteCoupon: async (id: number): Promise<void> => {
    await apiClient.delete(`/admin/coupons/${id}`);
  },
  issueVouchers: async (couponId: number, customerIds: number[]): Promise<{ issued: number; existing: number }> => {
    const r = await apiClient.post(`/admin/coupons/${couponId}/issue-vouchers`, { customer_ids: customerIds });
    return r.data;
  },
  getCouponVouchers: async (couponId: number): Promise<CouponVoucher[]> => {
    const r = await apiClient.get(`/admin/coupons/${couponId}/vouchers`);
    return r.data;
  },
  getCouponReport: async (couponId: number): Promise<OfferReport> => {
    const r = await apiClient.get(`/admin/coupons/${couponId}/report`);
    return r.data;
  },
  getCustomerVouchers: async (phone: string): Promise<{ customer: { id: number; name: string | null; phone: string | null } | null; vouchers: CouponVoucher[] }> => {
    const r = await apiClient.get('/admin/coupons/customer-vouchers', { params: { phone } });
    return r.data;
  },

  // Campaigns + items + report
  getCampaigns: async (): Promise<Campaign[]> => {
    const r = await apiClient.get('/admin/campaigns');
    return r.data;
  },
  createCampaign: async (data: Partial<Campaign>): Promise<Campaign> => {
    const r = await apiClient.post('/admin/campaigns', data);
    return r.data;
  },
  updateCampaign: async (id: number, data: Partial<Campaign>): Promise<Campaign> => {
    const r = await apiClient.put(`/admin/campaigns/${id}`, data);
    return r.data;
  },
  deleteCampaign: async (id: number): Promise<void> => {
    await apiClient.delete(`/admin/campaigns/${id}`);
  },
  getCampaignReport: async (id: number): Promise<OfferReport> => {
    const r = await apiClient.get(`/admin/campaigns/${id}/report`);
    return r.data;
  },
  getCampaignItems: async (id: number): Promise<CampaignItem[]> => {
    const r = await apiClient.get(`/admin/campaigns/${id}/items`);
    return r.data;
  },
  createCampaignItem: async (id: number, data: Partial<CampaignItem>): Promise<CampaignItem> => {
    const r = await apiClient.post(`/admin/campaigns/${id}/items`, data);
    return r.data;
  },
  updateCampaignItem: async (id: number, itemId: number, data: Partial<CampaignItem>): Promise<CampaignItem> => {
    const r = await apiClient.put(`/admin/campaigns/${id}/items/${itemId}`, data);
    return r.data;
  },
  deleteCampaignItem: async (id: number, itemId: number): Promise<void> => {
    await apiClient.delete(`/admin/campaigns/${id}/items/${itemId}`);
  },

  // Offer engine settings
  getOfferSettings: async (): Promise<OfferSettings> => {
    const r = await apiClient.get('/admin/offer-settings');
    return r.data;
  },
  updateOfferSettings: async (data: Partial<OfferSettings>): Promise<OfferSettings> => {
    const r = await apiClient.put('/admin/offer-settings', data);
    return r.data;
  },

  // Shifts (opened per brand per branch)
  getShifts: async (branchId?: number, status?: string, brandId?: number): Promise<Shift[]> => {
    const params = new URLSearchParams();
    if (branchId) params.append('branch_id', branchId.toString());
    if (brandId) params.append('brand_id', brandId.toString());
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

  getShiftOrders: async (id: number): Promise<ShiftOrdersResponse> => {
    const response = await apiClient.get(`/admin/shifts/${id}/orders`);
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

  // Riders (for delivery assignment) — includes all-time customer star averages (tenant orders only).
  // brandId filters to riders linked to that brand (pass the order's brand for the dispatch dropdown).
  getRiders: async (
    brandId?: number,
  ): Promise<
    Array<{
      id: number;
      name: string;
      email: string | null;
      phone: string | null;
      rating_average: number | null;
      rating_count: number;
    }>
  > => {
    const query = brandId != null ? `?brand_id=${brandId}` : '';
    const response = await apiClient.get(`/admin/orders/riders${query}`);
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

  // ——— Rider brand-ownership & sharing ———

  // Owner/GM: all tenant riders with their brand links + owner badges.
  getPoolRidersForOwner: async (): Promise<RiderWithBrands[]> => {
    const response = await apiClient.get('/admin/rider-sharing/riders');
    return response.data ?? [];
  },

  getRiderBrands: async (riderUserId: number): Promise<RiderBrandLink[]> => {
    const response = await apiClient.get(
      `/admin/rider-sharing/riders/${riderUserId}/brands`,
    );
    return response.data ?? [];
  },

  assignRiderBrand: async (
    riderUserId: number,
    brandId: number,
  ): Promise<RiderBrandLink[]> => {
    const response = await apiClient.post(
      `/admin/rider-sharing/riders/${riderUserId}/brands`,
      { brand_id: brandId },
    );
    return response.data ?? [];
  },

  removeRiderBrand: async (
    riderUserId: number,
    brandId: number,
  ): Promise<RiderBrandLink[]> => {
    const response = await apiClient.delete(
      `/admin/rider-sharing/riders/${riderUserId}/brands/${brandId}`,
    );
    return response.data ?? [];
  },

  setRiderBrands: async (
    riderUserId: number,
    brandIds: number[],
  ): Promise<RiderBrandLink[]> => {
    const response = await apiClient.put(
      `/admin/rider-sharing/riders/${riderUserId}/brands`,
      { brand_ids: brandIds },
    );
    return response.data ?? [];
  },

  // Owner/GM: review incoming share requests.
  getShareRequestsForOwner: async (
    status?: RiderShareRequestStatus,
  ): Promise<RiderShareRequest[]> => {
    const query = status ? `?status=${status}` : '';
    const response = await apiClient.get(
      `/admin/rider-sharing/requests${query}`,
    );
    return response.data ?? [];
  },

  approveShareRequest: async (id: number): Promise<{ id: number; status: string }> => {
    const response = await apiClient.post(
      `/admin/rider-sharing/requests/${id}/approve`,
    );
    return response.data;
  },

  declineShareRequest: async (
    id: number,
    reason?: string,
  ): Promise<{ id: number; status: string }> => {
    const response = await apiClient.post(
      `/admin/rider-sharing/requests/${id}/decline`,
      { reason },
    );
    return response.data;
  },

  // Brand admin: browse the Foodies pool + submit/cancel requests.
  getAvailablePoolRiders: async (
    brandId: number,
  ): Promise<PoolRiderSummary[]> => {
    const response = await apiClient.get(
      `/admin/rider-hrm/pool-riders?brand_id=${brandId}`,
    );
    return response.data ?? [];
  },

  createRiderShareRequest: async (data: {
    brand_id: number;
    rider_user_id: number;
    note?: string;
  }): Promise<{ id: number; status: string }> => {
    const response = await apiClient.post('/admin/rider-hrm/share-requests', data);
    return response.data;
  },

  getMyShareRequests: async (
    status?: RiderShareRequestStatus,
  ): Promise<RiderShareRequest[]> => {
    const query = status ? `?status=${status}` : '';
    const response = await apiClient.get(
      `/admin/rider-hrm/share-requests${query}`,
    );
    return response.data ?? [];
  },

  cancelRiderShareRequest: async (
    id: number,
  ): Promise<{ id: number; status: string }> => {
    const response = await apiClient.post(
      `/admin/rider-hrm/share-requests/${id}/cancel`,
    );
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

  // Bank cards (for card-linked discounts)
  getBankCards: async (activeOnly = false) => {
    const response = await apiClient.get('/admin/bank-cards', {
      params: activeOnly ? { active: 1 } : {},
    });
    return response.data as Array<{
      id: number;
      name: string;
      bank: string | null;
      network: string | null;
      bin_prefixes: string[] | null;
      /** The card's own discount; has_offer is false when it discounts nothing. */
      discount_type: 'flat' | 'percentage' | null;
      discount_value: number | null;
      min_order_amount: number | null;
      max_discount_amount: number | null;
      valid_from: string | null;
      valid_until: string | null;
      valid_time_start: string | null;
      valid_time_end: string | null;
      valid_days_of_week: number[] | null;
      has_offer: boolean;
      is_active: boolean;
    }>;
  },
  createBankCard: async (data: {
    name: string;
    bank?: string | null;
    network?: string | null;
    bin_prefixes?: string[] | null;
    eligibility_brand_ids?: number[] | null;
    discount_type?: 'flat' | 'percentage' | null;
    discount_value?: number | null;
    min_order_amount?: number | null;
    max_discount_amount?: number | null;
    valid_from?: string | null;
    valid_until?: string | null;
    valid_time_start?: string | null;
    valid_time_end?: string | null;
    valid_days_of_week?: number[] | null;
    is_active?: boolean;
  }) => {
    const response = await apiClient.post('/admin/bank-cards', data);
    return response.data;
  },
  updateBankCard: async (
    id: number,
    data: {
      name?: string;
      bank?: string | null;
      network?: string | null;
      bin_prefixes?: string[] | null;
      eligibility_brand_ids?: number[] | null;
      discount_type?: 'flat' | 'percentage' | null;
      discount_value?: number | null;
      min_order_amount?: number | null;
      max_discount_amount?: number | null;
      valid_from?: string | null;
      valid_until?: string | null;
      valid_time_start?: string | null;
      valid_time_end?: string | null;
      valid_days_of_week?: number[] | null;
      is_active?: boolean;
    },
  ) => {
    const response = await apiClient.put(`/admin/bank-cards/${id}`, data);
    return response.data;
  },
  deleteBankCard: async (id: number) => {
    const response = await apiClient.delete(`/admin/bank-cards/${id}`);
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
    gst_rate_cash?: number | null;
    gst_rate_card?: number | null;
    loyalty_enabled?: boolean;
  }) => {
    const response = await apiClient.put('/admin/business-settings', data);
    return response.data;
  },

  // Brands (for the per-brand loyalty selector)
  getBrands: async (): Promise<
    Array<{ id: number; name: string; loyalty_enabled?: boolean }>
  > => {
    const response = await apiClient.get('/admin/brands');
    return response.data ?? [];
  },

  // Loyalty settings (per brand)
  getLoyaltySettings: async (brandId: number) => {
    const response = await apiClient.get(`/admin/brands/${brandId}/loyalty-settings`);
    return response.data;
  },

  updateLoyaltySettings: async (
    brandId: number,
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
    const response = await apiClient.put(`/admin/brands/${brandId}/loyalty-settings`, data);
    return response.data;
  },

  // Tier-based delivery config (per brand)
  getDeliveryTiers: async (brandId: number) => {
    const response = await apiClient.get(`/admin/brands/${brandId}/delivery-tiers`);
    return response.data;
  },

  updateDeliveryTiers: async (
    brandId: number,
    data: {
      delivery_tiers_enabled?: boolean;
      tiers?: Record<string, unknown>;
    },
  ) => {
    const response = await apiClient.put(`/admin/brands/${brandId}/delivery-tiers`, data);
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

  createCustomer: async (data: { name: string; phone: string; link?: boolean }) => {
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

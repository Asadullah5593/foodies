export interface User {
  id: number;
  name: string;
  email: string;
  tenant_id: number | null;
  phone?: string;
  status: string;
  is_super_admin?: boolean;
  is_rider?: boolean;
  /** Role slug (e.g. owner, cashier, rider) */
  role?: string | null;
  /** Role id for forms */
  role_id?: number | null;
}

export interface Tenant {
  id: number;
  name: string;
  slug: string;
  status: string;
  legal_name?: string;
  default_currency?: string;
  default_timezone?: string;
  default_tax_rate?: number;
  default_service_charge?: number;
  loyalty_enabled?: boolean;
}

export interface Brand {
  id: number;
  tenant_id: number;
  name: string;
  slug: string;
  logo_url?: string;
  description?: string;
  status: string;
  /** Present when super admin lists brands (to show which tenant) */
  tenant_name?: string;
}

export interface Branch {
  id: number;
  /** One or more brands (many-to-many; e.g. food court). */
  brand_ids: number[];
  name: string;
  code: string;
  address?: string;
  phone?: string;
  email?: string;
  timezone?: string;
  operating_hours?: Record<string, unknown>;
  supports_dine_in?: boolean;
  supports_takeaway?: boolean;
  supports_pickup?: boolean;
  supports_delivery?: boolean;
  delivery_flat_fee?: number;
  is_active?: boolean;
  /** When false, POS/KDS/consumer menu for this branch returns empty */
  menu_enabled?: boolean;
  status: string;
  /** Present when super admin lists branches */
  tenant_id?: number;
  tenant_name?: string;
  brand_names?: string[];
}

export interface MenuItem {
  id: number;
  tenant_id?: number;
  category_id: number;
  name: string;
  description?: string;
  base_price: number;
  is_active: boolean;
  category?: {
    id: number;
    name: string;
  };
  variants?: MenuVariant[];
  addons?: MenuAddon[];
  // POS specific
  price?: number;
  /** Brand id (for multi-brand cart splitting). */
  brand_id?: number | null;
}

export interface MenuVariant {
  id: number;
  menu_item_id: number;
  name: string;
  price_modifier: number;
  is_default: boolean;
  sort_order: number;
}

export interface MenuAddon {
  id: number;
  tenant_id?: number;
  name: string;
  price: number;
  /** API may return is_active (snake_case) or isActive (camelCase) */
  is_active?: boolean;
  isActive?: boolean;
  sort_order?: number;
}

export interface BranchMenuItem {
  id: number;
  branch_id: number;
  menu_item_id: number;
  price_override?: number;
  is_enabled: boolean;
  menu_item?: MenuItem;
}

export interface Discount {
  id: number;
  tenant_id: number;
  name: string;
  code: string | null;
  /** When true: coupon/promo only (user must enter code). When false: auto-applied when scope/eligibility match. */
  requires_code?: boolean;
  type: 'flat' | 'percentage';
  value: number;
  min_order_amount?: number;
  max_discount_amount?: number;
  pos_only?: boolean;
  allowed_roles?: string[];
  /** What gets discounted: whole_order | category | products */
  application_scope?: string;
  /** Category IDs when scope=category, menu_item IDs when scope=products */
  application_scope_ids?: number[];
  /** Order must be from one of these branches (null = any) */
  eligibility_branch_ids?: number[];
  /** Order must be from a branch of one of these brands (null = any) */
  eligibility_brand_ids?: number[];
  is_active: boolean;
  valid_from?: string;
  valid_until?: string;
}

export interface Shift {
  id: number;
  branch_id: number;
  user_id: number;
  shift_number: string;
  opening_cash: number;
  expected_cash?: number;
  actual_cash?: number;
  difference?: number;
  status: 'open' | 'closed';
  opened_at: string;
  closed_at?: string;
  notes?: string;
  user?: User;
  branch?: Branch;
}

export interface Order {
  id: number;
  order_number: string;
  order_type: 'dine_in' | 'takeaway' | 'pickup' | 'delivery';
  status: string;
  total_amount: number;
  subtotal?: number;
  discount_amount?: number;
  tax_amount?: number;
  service_charge?: number;
  delivery_fee?: number;
  discount_code?: string;
  items?: OrderItem[];
  branch?: { id: number; name: string; code: string };
  creator?: { id: number; name: string };
  payments?: Array<{ id: number; method: string; amount: number; status: string; paid_at?: string }>;
  order_group_id?: string | null;
  brand_id?: number | null;
  brand_name?: string | null;
}

/** Response when placing an order (single or multi-brand: always has order_group_id and orders array). */
export interface CreateOrderResponse {
  order_group_id: string;
  orders: Order[];
}

export interface OrderItem {
  id: number;
  menu_item?: string;
  name_snapshot?: string;
  variant_name?: string;
  quantity: number;
  unit_price: number;
  price_snapshot?: number;
  subtotal: number;
  notes?: string;
  addons?: Array<{ name: string; unit_price: number; quantity: number }>;
}

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
  /** Permission names for RBAC (e.g. orders:view, kitchen:view) */
  permissions?: string[];
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
  /** All-time consumer brand ratings (admin / POS) */
  rating_average?: number | null;
  rating_count?: number;
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
  supports_delivery?: boolean;
  delivery_flat_fee?: number;
  delivery_radius_km?: number;
  latitude?: number | null;
  longitude?: number | null;
  is_active?: boolean;
  /** When false, POS/KDS/consumer menu for this branch returns empty */
  menu_enabled?: boolean;
  status: string;
  /** Present when super admin lists branches */
  tenant_id?: number;
  tenant_name?: string;
  brand_names?: string[];
}

export interface RiderProfile {
  id: number;
  user_id: number;
  user_name?: string | null;
  user_phone?: string | null;
  tenant_id: number;
  employment_status: string;
  salary_type: string;
  employee_code?: string | null;
  base_salary: number;
  default_per_ride_commission: number;
  max_active_orders: number;
  min_rating?: number | null;
  min_timely_rate?: number | null;
  is_active: boolean;
  metadata?: Record<string, unknown>;
  updated_at?: string | null;
}

export interface RiderOnDuty {
  rider_user_id: number;
  branch_id: number;
  is_checked_in: boolean;
  is_paused: boolean;
  pause_reason?: string | null;
  last_heartbeat_at?: string | null;
  last_location_at?: string | null;
  last_latitude?: number | null;
  last_longitude?: number | null;
}

export interface RiderAttendanceStatus
  extends Omit<RiderOnDuty, 'branch_id'> {
  branch_id: number | null;
  branch_name?: string | null;
}

export interface RiderCompPlanComponent {
  id?: number;
  component_key: string;
  name: string;
  component_type: string;
  calc_basis: string;
  value: number;
  conditions?: Record<string, unknown>;
  is_enabled?: boolean;
  sort_order?: number;
}

export interface RiderCompPlan {
  id: number;
  tenant_id: number;
  branch_id?: number | null;
  name: string;
  pay_method: string;
  status: string;
  version: number;
  effective_from?: string | null;
  effective_to?: string | null;
  component_count?: number;
  components: RiderCompPlanComponent[];
}

export interface RiderPayrollLineItem {
  id: number;
  component_key: string;
  component_name: string;
  amount: number;
  formula_meta: Record<string, unknown>;
}

export interface RiderPayrollLine {
  id: number;
  rider_user_id: number;
  plan_id?: number | null;
  total_amount: number;
  attendance_minutes: number;
  completed_rides: number;
  timely_deliveries: number;
  avg_rating?: number | null;
  items: RiderPayrollLineItem[];
}

export interface RiderPayrollRun {
  id: number;
  tenant_id: number;
  branch_id?: number | null;
  period_from: string;
  period_to: string;
  status: string;
  rule_version?: string | null;
  finalized_at?: string | null;
  rider_count?: number;
  total_amount?: number;
  lines?: RiderPayrollLine[];
}

export interface RiderOpsMetricsSnapshot {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  samples: Record<string, { count: number; p95: number }>;
  generated_at: string;
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
  modifier_groups?: MenuModifierGroup[];
  // POS specific
  price?: number;
  /** Brand id (for multi-brand cart splitting). */
  brand_id?: number | null;
  /** Main image: POS tile, menu lists, consumer product hero. */
  image_url?: string | null;
  /** Extra photos (ordered) for consumer website gallery under the hero; not used as the POS thumbnail. */
  gallery_image_urls?: string[];
  /** When set, limits which order channels can include this item (delivery, pickup, dine_in). Omit/null = all. */
  available_for_order_types?: string[] | null;
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

export interface MenuModifier {
  id: number;
  name: string;
  price: number;
}

export interface MenuModifierGroup {
  id: number;
  name: string;
  min_select: number;
  max_select: number;
  modifiers: MenuModifier[];
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
  /** Sum of cash payments from completed orders in this shift. */
  cash_collected?: number;
  /** Sum of card payments from completed orders in this shift. */
  card_collected?: number;
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
  /** Where the order was placed from (POS vs consumer app). */
  source?: 'pos' | 'consumer_app' | string;
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

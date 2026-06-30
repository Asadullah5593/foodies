export interface User {
  id: number;
  name: string;
  email: string;
  tenant_id: number | null;
  phone?: string;
  status: string;
  is_super_admin?: boolean;
  /** Owner (or super admin) — the only roles allowed to manage their own account. */
  is_owner?: boolean;
  is_rider?: boolean;
  /** Role slug (e.g. owner, cashier, rider) */
  role?: string | null;
  /** Role id for forms */
  role_id?: number | null;
  /** Permission names for RBAC (e.g. orders:view, kitchen:view) */
  permissions?: string[];
  /** Brand lock: null = all brands; number[] = user only sees/sells these brands */
  allowed_brand_ids?: number[] | null;
  /** Convenience: the single locked brand id when allowed_brand_ids has exactly one */
  brand_id?: number | null;
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
  /** Aggregate online open/close across this brand's branches (admin list). */
  online_status?: 'open' | 'closed' | 'partial' | 'none';
  /** Number of branches this brand is at (admin list). */
  online_branch_count?: number;
  /** Flat delivery fee charged on each delivery order of this brand. */
  delivery_flat_fee?: number;
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
  /** null = Foodies pool rider (no owning brand). */
  owner_brand_id?: number | null;
  owner_brand_name?: string | null;
  /** Brands this rider serves (owned + shared); empty = not dispatchable. */
  brand_ids?: number[];
  brands?: RiderBrandLink[];
}

/** Source of truth for rider↔brand availability: 'owned' (creator) or 'shared'. */
export interface RiderBrandLink {
  rider_user_id?: number;
  id?: number;
  brand_id?: number;
  name?: string;
  brand_name?: string;
  source: 'owned' | 'shared';
}

/** A rider with their brand links, for the owner/GM pool screen. */
export interface RiderWithBrands {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  owner_brand_id: number | null;
  owner_brand_name: string | null;
  brand_ids: number[];
  brands: Array<{ id: number; name: string; source: 'owned' | 'shared' }>;
  is_dispatchable: boolean;
  rating_count: number;
  rating_average: number | null;
}

export type RiderShareRequestStatus =
  | 'pending'
  | 'approved'
  | 'declined'
  | 'cancelled';

export interface RiderShareRequest {
  id: number;
  tenant_id: number;
  requesting_brand_id: number;
  brand_name?: string | null;
  rider_user_id: number;
  rider_name?: string | null;
  status: RiderShareRequestStatus;
  note?: string | null;
  requested_by_user_id?: number | null;
  requested_by_name?: string | null;
  decided_by_user_id?: number | null;
  decided_at?: string | null;
  decline_reason?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** A Foodies-pool rider a brand may request, annotated for the brand. */
export interface PoolRiderSummary {
  id: number;
  name: string;
  phone: string | null;
  rating_average: number | null;
  rating_count: number;
  request_status: RiderShareRequestStatus | null;
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

export interface RiderBreakSession {
  id: number;
  rider_user_id: number;
  attendance_session_id?: number | null;
  branch_id?: number | null;
  started_at: string;
  ended_at?: string | null;
  reason?: string | null;
  created_at: string;
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
  /** Allergen labels shown to customers. */
  allergens?: string[] | null;
  /** Energy in kcal for the standard serving. */
  calories?: number | null;
  /** Short badge/tag (e.g. "Classic", "Signature"). */
  label?: string | null;
  /** Recurring availability window (branch timezone), HH:mm; null = all day. */
  available_time_start?: string | null;
  available_time_end?: string | null;
  /** Recurring days available: 0=Sun … 6=Sat; null/empty = every day. */
  available_days_of_week?: number[] | null;
  /** Server-computed (branch timezone): is this orderable right now? Only present on the branch menu. */
  available_now?: boolean;
}

export interface MenuVariant {
  id: number;
  menu_item_id: number;
  name: string;
  price_modifier: number;
  is_default: boolean;
  sort_order: number;
  /** Normalized size ('7','10','12','14') enabling per-size modifier pricing; null = no size. */
  size_key?: string | null;
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
  /** Per-size surcharge keyed by variant size_key (e.g. {"7":99,"12":249}); null = use flat price. */
  price_by_size?: Record<string, number> | null;
  /** Restrict this option to certain sizes (e.g. ["10","12","14"]); null/empty = every size. */
  available_for_sizes?: string[] | null;
}

export interface MenuModifierGroup {
  id: number;
  name: string;
  min_select: number;
  max_select: number;
  /** Units included free before any are charged ("first N free"). */
  included_quantity?: number;
  /** Per-size override of included_quantity keyed by variant size_key. */
  included_by_size?: Record<string, number> | null;
  /** Allow the same free/optional option to be added multiple times (qty stepper). */
  allow_quantity?: boolean;
  /** Quantity-tiered bundle price for charged units (charged count → total), e.g. {"1":99,"2":169,"3":249}. */
  price_tiers?: Record<string, number> | null;
  /** Hide this cross-sell group when customizing the item inside a deal. */
  hide_in_deals?: boolean;
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
  type: 'flat' | 'percentage' | 'buy_x_get_y';
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
  /** Recurring time-of-day window (branch timezone), HH:mm. */
  valid_time_start?: string | null;
  valid_time_end?: string | null;
  /** Recurring days: 0=Sun … 6=Sat. */
  valid_days_of_week?: number[] | null;
  /** Buy-X-get-Y (BOGO) — only when type='buy_x_get_y'. */
  buy_quantity?: number | null;
  get_quantity?: number | null;
  get_discount_percent?: number | null;
  /** Pair only within same category + variant size (e.g. 2nd Large pizza half price). */
  bogo_match_same_group?: boolean;
}

export interface Banner {
  id: number;
  tenant_id: number;
  title: string;
  subtitle: string | null;
  image_url: string;
  link_url: string | null;
  is_active: boolean;
  sort_order: number;
  valid_from: string | null;
  valid_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface Promotion {
  id: number;
  tenant_id: number;
  name: string;
  description: string | null;
  image_url: string | null;
  promotion_type: 'discount' | 'free_item';
  discount_type: 'flat' | 'percentage' | null;
  discount_value: number | null;
  free_menu_item_id: number | null;
  eligibility_type: 'new_customer' | 'manual';
  is_active: boolean;
  expires_in_days: number | null;
  valid_from: string | null;
  valid_until: string | null;
  created_at: string;
}

export interface CustomerPromotion {
  id: number;
  customer_id: number;
  promotion_id: number;
  coupon_code: string | null;
  discount_id: number | null;
  status: 'pending' | 'claimed' | 'used' | 'expired';
  assigned_at: string;
  expires_at: string | null;
  claimed_at: string | null;
  used_at: string | null;
  promotion?: Promotion;
}

export interface Shift {
  id: number;
  branch_id: number;
  /** Brand the shift was opened for (shifts are per brand per branch). */
  brand_id?: number | null;
  brand?: { id: number; name: string } | null;
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
  closed_by_user_id?: number | null;
  notes?: string;
  user?: User;
  /** User who closed the shift. */
  closer?: User;
  branch?: Branch;
}

/** A completed order within a shift, for the close-shift review list. */
export interface ShiftOrder {
  id: number;
  order_number: string;
  total_amount: number;
  completed_at: string | null;
  status: string;
  payment_method: string | null;
  customer_name: string | null;
}

export interface ShiftOrdersResponse {
  shift_id: number;
  order_count: number;
  total_amount: number;
  cash_collected: number;
  card_collected: number;
  orders: ShiftOrder[];
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

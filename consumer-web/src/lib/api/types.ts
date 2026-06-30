export type Branch = {
  id: number;
  name: string;
  code?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  supports_dine_in?: boolean;
  supports_takeaway?: boolean;
  supports_pickup?: boolean;
  supports_delivery?: boolean;
  latitude?: number | null;
  longitude?: number | null;
  distance_km?: number | null;
  /** Linked brands at this branch from API; home list only shows branches with a non-empty list. */
  brand_ids?: number[];
};

export type Brand = {
  id: number;
  name: string;
  logo_url?: string | null;
  /** Per-branch online availability (present on brand-by-branch listings). false = closed for online orders. */
  is_open?: boolean;
};

export type Modifier = {
  id: number;
  name: string;
  price: number;
  /** Per-size surcharge keyed by variant size_key (e.g. {"7":99,"12":249}); null = use flat price. */
  price_by_size?: Record<string, number> | null;
  /** Restrict this option to certain sizes (e.g. ["10","12","14"]); null/empty = every size. */
  available_for_sizes?: string[] | null;
  /** Admin/POS-configured display order within the group; lower shows first. */
  sort_order?: number;
};

export type ModifierGroup = {
  id: number;
  name: string;
  min_select?: number;
  max_select?: number;
  /** Units included free before any are charged ("first N free"). */
  included_quantity?: number;
  /** Per-size override of included_quantity keyed by variant size_key. */
  included_by_size?: Record<string, number> | null;
  /** Allow the same free/optional option to be added multiple times (qty stepper). */
  allow_quantity?: boolean;
  /** Quantity-tiered bundle price for charged units (charged count → total). */
  price_tiers?: Record<string, number> | null;
  modifiers: Modifier[];
};

export type Variant = {
  id: number;
  name: string;
  price_modifier: number;
  is_default?: boolean;
  isDefault?: boolean;
  /** Normalized size ('7','10','12','14') enabling per-size modifier pricing; null = no size. */
  size_key?: string | null;
};

export type Addon = {
  id: number;
  name: string;
  price: number;
};

export type MenuItem = {
  id: number;
  name: string;
  description?: string | null;
  image_url?: string | null;
  price: number;
  base_price?: number;
  category?: string | null;
  /** From API: which order channels this item supports; omit/empty treated as all channels. */
  available_for_order_types?: string[] | null;
  /** From API: extra photos for product page gallery (ordered). */
  gallery_image_urls?: string[];
  variants: Variant[];
  addons: Addon[];
  modifier_groups: ModifierGroup[];
};

/** Lightweight item returned by the tenant-wide menu search (header autocomplete). */
export type MenuSearchResult = {
  id: number;
  name: string;
  description?: string | null;
  image_url?: string | null;
  price: number;
  category?: string | null;
  brand_id: number | null;
  brand_name?: string | null;
};

export type CartAddon = { addon_id: number; quantity?: number };
export type CartModifier = { modifier_id: number; quantity?: number };

export type CartItem = {
  id: number;
  menu_item_id: number;
  menu_item_name?: string | null;
  variant_id?: number | null;
  variant_name?: string | null;
  quantity: number;
  notes?: string | null;
  addons: CartAddon[];
  modifiers: CartModifier[];
};

export type CartResponse = {
  cart_id: number;
  branch_id: number;
  items: CartItem[];
};

export type Customer = {
  id: number;
  tenant_id: number | null;
  phone: string;
  name: string;
  email?: string | null;
  loyalty_points_balance?: number;
};

export type LoginResponse = {
  token: string;
  customer: Customer;
};

export type PlaceOrderResponse = {
  order_group_id: string;
  orders: Array<{
    id: number;
    order_number: string;
    status: string;
    total_amount: number;
  }>;
};

export type OrderStatus = {
  id: number;
  order_number: string;
  status: string;
  total_amount: number;
};

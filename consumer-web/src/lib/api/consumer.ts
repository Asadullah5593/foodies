import { apiClient, withPlatformHeaders } from "./client";
import type {
  Brand,
  Branch,
  CartModifier,
  CartResponse,
  CartAddon,
  Customer,
  LoginResponse,
  LoyaltyBalance,
  MenuItem,
  OrderStatus,
  PlaceOrderResponse,
} from "./types";

export async function getNearbyBranches(latitude: number, longitude: number) {
  const { data } = await apiClient.get<Branch[]>("/public/consumer/branches", {
    params: { latitude, longitude, radius_km: 10 },
  });
  return data;
}

export async function getBrandsByBranch(branchId: number) {
  const { data } = await apiClient.get<Brand[]>("/public/consumer/brands", {
    params: { branch_id: branchId },
  });
  return data;
}

export async function getMenu(
  branchId: number,
  brandId: number,
  search?: string,
  orderType?: "delivery" | "pickup" | "dine_in" | "takeaway",
) {
  const { data } = await apiClient.get<MenuItem[]>("/public/consumer/menu", {
    params: {
      branch_id: branchId,
      brand_id: brandId,
      search: search?.trim() || undefined,
      order_type: orderType,
    },
  });
  return data;
}

export async function getMenuItemDetail(
  itemId: number,
  branchId: number,
  orderType?: "delivery" | "pickup" | "dine_in" | "takeaway",
) {
  const { data } = await apiClient.get<MenuItem>(`/public/consumer/menu/items/${itemId}`, {
    params: { branch_id: branchId, order_type: orderType },
  });
  return data;
}

export async function registerCustomer(input: {
  name: string;
  email: string;
  phone: string;
  password: string;
  confirm_password: string;
}) {
  const { data } = await apiClient.post<Customer>("/public/consumer/register", input);
  return data;
}

export async function loginCustomer(input: { email: string; password: string }) {
  const { data } = await apiClient.post<LoginResponse>("/public/consumer/auth/login", input);
  return data;
}

export async function getCart(phone: string, branchId: number) {
  const { data } = await apiClient.get<CartResponse>("/public/consumer/cart", {
    params: { phone, branch_id: branchId },
  });
  return data;
}

export async function addCartItem(input: {
  phone: string;
  branch_id: number;
  menu_item_id: number;
  quantity: number;
  variant_id?: number;
  addons?: CartAddon[];
  modifiers?: CartModifier[];
  notes?: string;
}) {
  const { data } = await apiClient.post("/public/consumer/cart/items", input);
  return data;
}

export async function updateCartItem(
  itemId: number,
  input: {
    phone: string;
    branch_id: number;
    quantity?: number;
    variant_id?: number | null;
    addons?: CartAddon[] | null;
    modifiers?: CartModifier[] | null;
    notes?: string | null;
  },
) {
  const { data } = await apiClient.patch(`/public/consumer/cart/items/${itemId}`, input, {
    params: { phone: input.phone, branch_id: input.branch_id },
  });
  return data;
}

export async function removeCartItem(itemId: number, phone: string, branchId: number) {
  const { data } = await apiClient.delete(`/public/consumer/cart/items/${itemId}`, {
    params: { phone, branch_id: branchId },
  });
  return data;
}

export async function clearCart(phone: string, branchId: number) {
  const { data } = await apiClient.delete("/public/consumer/cart", {
    params: { phone, branch_id: branchId },
  });
  return data;
}

export async function getLoyaltyBalance(phone: string, branchId: number) {
  const { data } = await apiClient.get<LoyaltyBalance>("/public/consumer/loyalty/balance", {
    params: { phone, branch_id: branchId },
  });
  return data;
}

export async function placeOrder(input: {
  branch_id: number;
  order_type: "delivery" | "pickup";
  customer_name?: string;
  customer_phone?: string;
  delivery_address?: string;
  items: Array<{
    menu_item_id: number;
    quantity: number;
    variant_id?: number | null;
    addons?: CartAddon[];
    modifiers?: CartModifier[];
    notes?: string | null;
  }>;
  notes?: string;
  discount_code?: string;
  loyalty_points_to_redeem?: number;
}) {
  const { data } = await apiClient.post<PlaceOrderResponse>("/public/consumer/orders", input, {
    headers: withPlatformHeaders(),
  });
  return data;
}

export async function getOrderStatus(orderId: number) {
  const { data } = await apiClient.get<OrderStatus>(`/public/consumer/orders/${orderId}/status`);
  return data;
}

export async function getOrderDetails(orderId: number, phone: string) {
  const { data } = await apiClient.get(`/public/consumer/orders/${orderId}`, {
    params: { phone },
  });
  return data;
}

export async function getOrderHistory(phone: string, branchId?: number) {
  const { data } = await apiClient.get("/public/consumer/orders", {
    params: { phone, branch_id: branchId },
    headers: withPlatformHeaders(),
  });
  return data;
}

"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useSessionStore } from "@/lib/store/session-store";
import { getCart, getLoyaltyBalance, getNearbyBranches, placeOrder } from "@/lib/api/consumer";
import { AppShell, Button, Card, Input, Loader, SectionTitle, Select } from "@/components/ui";
import { TopNav } from "@/components/top-nav";

export default function CheckoutPage() {
  const router = useRouter();
  const customer = useSessionStore((s) => s.customer);
  const selectedBranchId = useSessionStore((s) => s.selectedBranchId);
  const selectedBranch = useSessionStore((s) => s.selectedBranch);
  const userLocation = useSessionStore((s) => s.userLocation);
  const branchSearchLocation = useSessionStore((s) => s.branchSearchLocation);
  const [orderTypeSelection, setOrderTypeSelection] = useState<"delivery" | "pickup">(
    "delivery",
  );
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [discountCode, setDiscountCode] = useState("");
  const [redeemPoints, setRedeemPoints] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "online">("cash");

  const queryCoords = userLocation ?? branchSearchLocation;

  const branchMetaQuery = useQuery({
    queryKey: ["checkout-branches-meta", queryCoords?.latitude, queryCoords?.longitude],
    queryFn: () => getNearbyBranches(queryCoords!.latitude, queryCoords!.longitude),
    enabled: Boolean(queryCoords && selectedBranchId && !selectedBranch),
  });
  const resolvedBranch = useMemo(
    () =>
      selectedBranch ??
      (branchMetaQuery.data ?? []).find((branch) => branch.id === selectedBranchId) ??
      null,
    [branchMetaQuery.data, selectedBranch, selectedBranchId],
  );

  const pickupSupported = resolvedBranch
    ? resolvedBranch.supports_pickup === true || resolvedBranch.supports_takeaway === true
    : true;
  const deliverySupported = resolvedBranch ? resolvedBranch.supports_delivery !== false : true;
  const orderType: "delivery" | "pickup" =
    orderTypeSelection === "pickup" && !pickupSupported
      ? "delivery"
      : orderTypeSelection === "delivery" && !deliverySupported && pickupSupported
        ? "pickup"
        : orderTypeSelection;

  const cartQuery = useQuery({
    queryKey: ["cart", customer?.phone, selectedBranchId],
    queryFn: () => getCart(customer!.phone, selectedBranchId!),
    enabled: Boolean(customer?.phone && selectedBranchId),
  });

  const loyaltyQuery = useQuery({
    queryKey: ["loyalty", customer?.phone, selectedBranchId],
    queryFn: () => getLoyaltyBalance(customer!.phone, selectedBranchId!),
    enabled: Boolean(customer?.phone && selectedBranchId),
  });

  const placeOrderMutation = useMutation({
    mutationFn: placeOrder,
    onSuccess: (response) => {
      const first = response.orders?.[0];
      if (first?.id) {
        router.push(`/orders/${first.id}`);
      } else {
        router.push("/orders");
      }
    },
  });

  const orderItems = useMemo(() => {
    const items = cartQuery.data?.items ?? [];
    return items.map((i) => ({
      menu_item_id: i.menu_item_id,
      quantity: i.quantity,
      variant_id: i.variant_id ?? undefined,
      addons: i.addons ?? [],
      modifiers: i.modifiers ?? [],
      notes: i.notes ?? undefined,
    }));
  }, [cartQuery.data]);

  if (!customer || !selectedBranchId) {
    return (
      <AppShell>
        <TopNav />
        <Card>
          <p className="text-sm text-zinc-300">
            Please login and select a branch before checkout.
          </p>
          <div className="mt-3">
            <Button onClick={() => router.push("/login?redirect=/checkout")}>Login</Button>
          </div>
        </Card>
      </AppShell>
    );
  }

  const submit = () => {
    if (!orderItems.length) return;
    if (orderType === "delivery" && !address.trim()) return;
    if (orderType === "pickup" && !pickupSupported) return;
    if (orderType === "delivery" && !deliverySupported) return;
    placeOrderMutation.mutate({
      branch_id: selectedBranchId,
      order_type: orderType,
      customer_name: customer.name,
      customer_phone: customer.phone,
      delivery_address: orderType === "delivery" ? address.trim() : undefined,
      items: orderItems,
      notes: notes.trim() || undefined,
      discount_code: discountCode.trim() || undefined,
      loyalty_points_to_redeem: redeemPoints > 0 ? redeemPoints : undefined,
    });
  };

  return (
    <AppShell>
      <TopNav cartCount={cartQuery.data?.items?.length ?? 0} />
      <SectionTitle title="Checkout" subtitle="Review details and finalize your order." />

      {cartQuery.isLoading ? <Loader label="Loading checkout data..." /> : null}
      {!cartQuery.isLoading && !orderItems.length ? (
        <Card>
          <p className="text-sm text-zinc-300">Your cart is empty.</p>
          <div className="mt-3">
            <Button onClick={() => router.push("/")}>Back to menu</Button>
          </div>
        </Card>
      ) : null}

      {orderItems.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="space-y-3">
            <h3 className="text-lg font-semibold text-white">Order Details</h3>
            <div>
              <label className="mb-1 block text-sm text-zinc-300">Order type</label>
              <Select
                value={orderType}
                onChange={(e) => setOrderTypeSelection(e.target.value as "delivery" | "pickup")}
              >
                {deliverySupported ? <option value="delivery">Delivery</option> : null}
                {pickupSupported ? <option value="pickup">Pickup</option> : null}
                {!deliverySupported && !pickupSupported ? (
                  <option value="delivery">Unavailable</option>
                ) : null}
              </Select>
              {!pickupSupported ? (
                <p className="mt-1 text-xs text-amber-500">
                  Pickup is not available at this branch.
                </p>
              ) : null}
              {!deliverySupported ? (
                <p className="mt-1 text-xs text-amber-500">
                  Delivery is not available at this branch.
                </p>
              ) : null}
            </div>
            {orderType === "delivery" ? (
              <div>
                <label className="mb-1 block text-sm text-zinc-300">Delivery address</label>
                <Input value={address} onChange={(e) => setAddress(e.target.value)} />
              </div>
            ) : null}
            <div>
              <label className="mb-1 block text-sm text-zinc-300">Discount code (optional)</label>
              <Input value={discountCode} onChange={(e) => setDiscountCode(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm text-zinc-300">Order notes (optional)</label>
              <textarea
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </Card>

          <Card className="space-y-3">
            <h3 className="text-lg font-semibold text-white">Payment & Loyalty</h3>
            <div>
              <label className="mb-1 block text-sm text-zinc-300">Payment method</label>
              <div className="flex gap-2">
                <Button
                  variant={paymentMethod === "cash" ? "primary" : "secondary"}
                  onClick={() => setPaymentMethod("cash")}
                >
                  Cash on {orderType === "delivery" ? "delivery" : "pickup"}
                </Button>
                <Button variant="secondary" disabled title="Coming soon">
                  Online payment (coming soon)
                </Button>
              </div>
            </div>

            <div>
              <p className="text-sm text-zinc-300">
                Loyalty balance:{" "}
                <span className="font-semibold text-white">{loyaltyQuery.data?.balance ?? 0}</span>
              </p>
              <label className="mb-1 mt-2 block text-sm text-zinc-300">
                Redeem points
              </label>
              <Input
                type="number"
                min={0}
                value={redeemPoints}
                onChange={(e) => setRedeemPoints(Number(e.target.value) || 0)}
              />
            </div>

            <div className="rounded-lg border border-zinc-800 p-3">
              <p className="text-sm text-zinc-400">Items: {orderItems.length}</p>
              <p className="text-sm text-zinc-400">
                Customer: {customer.name} ({customer.phone})
              </p>
            </div>

            {paymentMethod === "online" ? (
              <p className="text-sm text-amber-300">
                Online payment is not integrated yet. Please use cash for now.
              </p>
            ) : null}
            {placeOrderMutation.isError ? (
              <p className="text-sm text-red-300">
                Could not place order. Please verify details and try again.
              </p>
            ) : null}
            <Button
              className="w-full"
              onClick={submit}
              disabled={
                placeOrderMutation.isPending ||
                paymentMethod !== "cash" ||
                (orderType === "pickup" && !pickupSupported) ||
                (orderType === "delivery" && !deliverySupported) ||
                (orderType === "delivery" && !address.trim())
              }
            >
              {placeOrderMutation.isPending ? "Placing order..." : "Finalize Order"}
            </Button>
          </Card>
        </div>
      ) : null}
    </AppShell>
  );
}

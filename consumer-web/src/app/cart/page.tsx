"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ItemConfigModal } from "@/components/item-config-modal";
import { TopNav } from "@/components/top-nav";
import { AppShell, Button, Card, Loader, SectionTitle } from "@/components/ui";
import {
  clearCart,
  getCart,
  getMenuItemDetail,
  removeCartItem,
  updateCartItem,
} from "@/lib/api/consumer";
import type { CartItem, MenuItem } from "@/lib/api/types";
import { useSessionStore } from "@/lib/store/session-store";

export default function CartPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const customer = useSessionStore((s) => s.customer);
  const selectedBranchId = useSessionStore((s) => s.selectedBranchId);
  const [editing, setEditing] = useState<{ item: CartItem; detail: MenuItem } | null>(null);

  const cartQuery = useQuery({
    queryKey: ["cart", customer?.phone, selectedBranchId],
    queryFn: () => getCart(customer!.phone, selectedBranchId!),
    enabled: Boolean(customer?.phone && selectedBranchId),
  });

  const invalidate = () => {
    if (customer?.phone && selectedBranchId) {
      queryClient.invalidateQueries({
        queryKey: ["cart", customer.phone, selectedBranchId],
      });
    }
  };

  const removeMutation = useMutation({
    mutationFn: (itemId: number) =>
      removeCartItem(itemId, customer!.phone, selectedBranchId!),
    onSuccess: invalidate,
  });

  const clearMutation = useMutation({
    mutationFn: () => clearCart(customer!.phone, selectedBranchId!),
    onSuccess: invalidate,
  });

  const updateMutation = useMutation({
    mutationFn: (input: {
      id: number;
      quantity?: number;
      variant_id?: number | null;
      addons?: { addon_id: number; quantity?: number }[] | null;
      modifiers?: { modifier_id: number; quantity?: number }[] | null;
      notes?: string | null;
    }) =>
      updateCartItem(input.id, {
        phone: customer!.phone,
        branch_id: selectedBranchId!,
        quantity: input.quantity,
        variant_id: input.variant_id,
        addons: input.addons,
        modifiers: input.modifiers,
        notes: input.notes,
      }),
    onSuccess: () => {
      invalidate();
      setEditing(null);
    },
  });

  if (!customer || !selectedBranchId) {
    return (
      <AppShell>
        <TopNav />
        <Card>
          <p className="text-sm text-zinc-300">
            Please login and select a branch first.
          </p>
          <div className="mt-3">
            <Button onClick={() => router.push("/login?redirect=/cart")}>Login</Button>
          </div>
        </Card>
      </AppShell>
    );
  }

  const items = cartQuery.data?.items ?? [];

  return (
    <AppShell>
      <TopNav cartCount={items.length} />
      <SectionTitle title="Your Cart" subtitle="Review and edit your selected items." />

      {cartQuery.isLoading ? <Loader label="Loading cart..." /> : null}

      {!cartQuery.isLoading && items.length === 0 ? (
        <Card>
          <p className="text-sm text-zinc-300">Your cart is empty.</p>
          <div className="mt-3">
            <Button onClick={() => router.push("/")}>Browse menu</Button>
          </div>
        </Card>
      ) : null}

      <div className="space-y-3">
        {items.map((item) => (
          <Card key={item.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-white">{item.menu_item_name || `Item #${item.menu_item_id}`}</p>
                <p className="mt-1 text-xs text-zinc-400">
                  Qty: {item.quantity} | Variant: {item.variant_name || "None"}
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  Addons: {item.addons?.length ?? 0} | Modifiers: {item.modifiers?.length ?? 0}
                </p>
                {item.notes ? <p className="mt-1 text-xs text-zinc-300">Note: {item.notes}</p> : null}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={async () => {
                    const detail = await getMenuItemDetail(item.menu_item_id, selectedBranchId);
                    setEditing({ item, detail });
                  }}
                >
                  Edit
                </Button>
                <Button variant="danger" onClick={() => removeMutation.mutate(item.id)}>
                  Remove
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {items.length > 0 ? (
        <Card className="mt-4">
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => clearMutation.mutate()}>
              Clear cart
            </Button>
            <Button onClick={() => router.push("/checkout")}>Checkout</Button>
          </div>
        </Card>
      ) : null}

      <ItemConfigModal
        key={`${editing?.item.id ?? "none"}-${editing ? "open" : "closed"}`}
        item={editing?.detail ?? null}
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        initialValue={
          editing
            ? {
                quantity: editing.item.quantity,
                variant_id: editing.item.variant_id ?? undefined,
                addons: editing.item.addons,
                modifiers: editing.item.modifiers,
                notes: editing.item.notes ?? undefined,
              }
            : undefined
        }
        onConfirm={(value) => {
          if (!editing) return;
          updateMutation.mutate({
            id: editing.item.id,
            quantity: value.quantity,
            variant_id: value.variant_id ?? null,
            addons: value.addons,
            modifiers: value.modifiers,
            notes: value.notes ?? null,
          });
        }}
      />
    </AppShell>
  );
}

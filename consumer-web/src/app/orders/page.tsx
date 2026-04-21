"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useSessionStore } from "@/lib/store/session-store";
import { getOrderHistory } from "@/lib/api/consumer";
import { AppShell, Button, Card, Loader, SectionTitle } from "@/components/ui";
import { TopNav } from "@/components/top-nav";

export default function OrdersPage() {
  const customer = useSessionStore((s) => s.customer);
  const branchId = useSessionStore((s) => s.selectedBranchId);

  const historyQuery = useQuery({
    queryKey: ["order-history", customer?.phone, branchId],
    queryFn: () => getOrderHistory(customer!.phone, branchId ?? undefined),
    enabled: Boolean(customer?.phone),
    refetchInterval: 20_000,
  });

  if (!customer) {
    return (
      <AppShell>
        <TopNav />
        <Card>
          <p className="text-sm text-zinc-300">Login to view your order history.</p>
          <div className="mt-3">
            <Link href="/login?redirect=/orders">
              <Button>Login</Button>
            </Link>
          </div>
        </Card>
      </AppShell>
    );
  }

  const orders = (historyQuery.data as Array<{
    id: number;
    order_number: string;
    status: string;
    total_amount: number;
    placed_at: string;
  }>) || [];

  return (
    <AppShell>
      <TopNav />
      <SectionTitle title="Your Orders" subtitle="Track your latest order statuses." />

      {historyQuery.isLoading ? <Loader label="Loading your orders..." /> : null}

      <div className="space-y-3">
        {orders.map((order) => (
          <Card key={order.id}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-white">{order.order_number}</p>
                <p className="text-sm text-zinc-400">Status: {order.status}</p>
                <p className="text-sm text-zinc-400">Total: Rs. {order.total_amount}</p>
              </div>
              <Link href={`/orders/${order.id}`}>
                <Button variant="secondary">View</Button>
              </Link>
            </div>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}

"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getOrderDetails, getOrderStatus } from "@/lib/api/consumer";
import { useSessionStore } from "@/lib/store/session-store";
import { AppShell, Card, Loader, SectionTitle } from "@/components/ui";
import { TopNav } from "@/components/top-nav";

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const customer = useSessionStore((s) => s.customer);

  const statusQuery = useQuery({
    queryKey: ["order-status", id],
    queryFn: () => getOrderStatus(id),
    enabled: Number.isFinite(id),
    refetchInterval: 10_000,
  });

  const detailQuery = useQuery({
    queryKey: ["order-detail", id, customer?.phone],
    queryFn: () => getOrderDetails(id, customer!.phone),
    enabled: Number.isFinite(id) && Boolean(customer?.phone),
    refetchInterval: 10_000,
  });

  const detail = detailQuery.data as
    | {
        order_number: string;
        status: string;
        total_amount: number;
        order_type: string;
        delivery_address?: string | null;
        items: Array<{ name_snapshot: string; quantity: number; subtotal: number }>;
        payments?: Array<{ payment_method: string; amount: number; status: string }>;
      }
    | undefined;

  const timeline = useMemo(() => {
    const all = ["placed", "accepted", "preparing", "ready", "completed"];
    const current = statusQuery.data?.status || detail?.status || "placed";
    const idx = all.indexOf(current);
    return all.map((s, i) => ({ name: s, active: i <= (idx === -1 ? 0 : idx) }));
  }, [detail?.status, statusQuery.data?.status]);

  return (
    <AppShell>
      <TopNav />
      <SectionTitle title="Order Details" subtitle="Live updates are refreshed automatically." />

      {(statusQuery.isLoading || detailQuery.isLoading) ? (
        <Loader label="Loading order details..." />
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <p className="text-sm text-zinc-400">Order #</p>
          <p className="text-xl font-bold text-white">
            {statusQuery.data?.order_number || detail?.order_number}
          </p>
          <p className="mt-2 text-sm text-zinc-400">Current status</p>
          <p className="text-lg font-semibold text-red-400">
            {statusQuery.data?.status || detail?.status}
          </p>
          <p className="mt-2 text-sm text-zinc-400">
            Total: Rs. {statusQuery.data?.total_amount || detail?.total_amount || 0}
          </p>
        </Card>

        <Card>
          <p className="mb-2 text-sm font-semibold text-zinc-300">Status timeline</p>
          <div className="space-y-2">
            {timeline.map((step) => (
              <div key={step.name} className="flex items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${step.active ? "bg-red-500" : "bg-zinc-700"}`}
                />
                <span className={`${step.active ? "text-zinc-100" : "text-zinc-500"} text-sm capitalize`}>
                  {step.name}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <p className="mb-2 text-sm font-semibold text-zinc-300">Items</p>
        <div className="space-y-2">
          {(detail?.items ?? []).map((item, index) => (
            <div key={`${item.name_snapshot}-${index}`} className="flex justify-between text-sm text-zinc-300">
              <span>
                {item.name_snapshot} x{item.quantity}
              </span>
              <span>Rs. {item.subtotal}</span>
            </div>
          ))}
        </div>
      </Card>

      {(detail?.payments ?? []).length ? (
        <Card className="mt-4">
          <p className="mb-2 text-sm font-semibold text-zinc-300">Payments</p>
          <div className="space-y-2">
            {detail?.payments?.map((p, index) => (
              <div key={`${p.payment_method}-${index}`} className="flex justify-between text-sm text-zinc-300">
                <span className="capitalize">{p.payment_method}</span>
                <span>
                  Rs. {p.amount} ({p.status})
                </span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </AppShell>
  );
}

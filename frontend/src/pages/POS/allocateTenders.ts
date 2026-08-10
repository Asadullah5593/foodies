export interface TenderInput {
  method: 'cash' | 'card' | 'online_transfer';
  amount: number;
}

export interface CreatedOrderLike {
  id: number;
  total_amount?: number;
}

export interface AllocatedTender {
  orderId: number;
  method: TenderInput['method'];
  amount: number;
}

/**
 * Allocate tenders across a created order group using the SERVER totals as the
 * source of truth. The cashier's entered amounts only contribute their ratio
 * (cash vs card split): the server may re-price the cart at placement (e.g. a
 * staff discount landing with the order while the on-screen quote is one
 * refresh stale), and tendering the stale client total is how recorded
 * payments drift above the bill. Per order, the last tender takes the rounding
 * remainder so the recorded payments sum to the order total exactly.
 */
export function allocateTenders(
  orders: CreatedOrderLike[],
  tenders: TenderInput[],
): AllocatedTender[] {
  const clientSum = tenders.reduce((s, t) => s + t.amount, 0);
  const out: AllocatedTender[] = [];
  if (!orders.length || !tenders.length || clientSum <= 0) return out;
  for (const order of orders) {
    const orderTotal = Number(order.total_amount ?? 0);
    if (orderTotal <= 0) continue;
    let remainingPaisa = Math.round(orderTotal * 100);
    tenders.forEach((t, i) => {
      const sharePaisa =
        i === tenders.length - 1
          ? remainingPaisa
          : Math.min(remainingPaisa, Math.round((orderTotal * t.amount * 100) / clientSum));
      remainingPaisa -= sharePaisa;
      if (sharePaisa > 0) {
        out.push({ orderId: order.id, method: t.method, amount: sharePaisa / 100 });
      }
    });
  }
  return out;
}

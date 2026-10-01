import React from 'react';

export type LoyaltyWalletChip = {
  wallet_type: 'pos' | 'app';
  brand_id: number | null;
  brand_name: string | null;
  balance: number;
};

/**
 * A customer's loyalty balances, one chip per wallet.
 *
 * The two kinds of points are different money and are spent in different
 * places, so they must never read as one figure:
 *  - POS points belong to ONE brand and are earned/redeemed only on that
 *    brand's POS and call-centre orders.
 *  - App points are one balance shared by every brand, earned/redeemed only
 *    on mobile-app orders.
 *
 * Each chip leads with a solid tag naming the kind — indigo "POS", emerald
 * "APP", the same colours the source badges use for those channels — so the
 * kind is readable before the number is. Where a customer registered (the
 * source badge) says nothing about which wallets they hold.
 */
const KIND = {
  pos: {
    tag: 'POS',
    tagCls: 'bg-indigo-600 text-white dark:bg-indigo-500',
    bodyCls:
      'border-indigo-200 bg-indigo-50 text-indigo-900 dark:border-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-100',
  },
  app: {
    tag: 'APP',
    tagCls: 'bg-emerald-600 text-white dark:bg-emerald-500',
    bodyCls:
      'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100',
  },
} as const;

function walletTitle(w: LoyaltyWalletChip): string {
  return w.wallet_type === 'app'
    ? 'Mobile app points — one balance shared by all brands; earned and redeemed only on mobile app orders'
    : `POS points for ${w.brand_name ?? 'this brand'} — earned and redeemed only on its POS and call-centre orders`;
}

const LoyaltyWalletChips: React.FC<{ wallets?: LoyaltyWalletChip[] | null }> = ({ wallets }) => {
  const list = wallets ?? [];
  if (list.length === 0) {
    return <p>Loyalty: 0 pts</p>;
  }
  // POS wallets first (in the order served), the shared app wallet last.
  const ordered = [
    ...list.filter((w) => w.wallet_type !== 'app'),
    ...list.filter((w) => w.wallet_type === 'app'),
  ];
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5" aria-label="Loyalty points">
      {ordered.map((w) => {
        const kind = KIND[w.wallet_type === 'app' ? 'app' : 'pos'];
        return (
          <span
            key={`${w.wallet_type}-${w.brand_id ?? 'shared'}`}
            data-wallet-type={w.wallet_type}
            title={walletTitle(w)}
            className={`inline-flex items-stretch overflow-hidden rounded-md border text-xs font-medium ${kind.bodyCls}`}
          >
            <span className={`flex items-center px-1.5 text-[10px] font-extrabold tracking-wide ${kind.tagCls}`}>
              {kind.tag}
            </span>
            <span className="px-2 py-0.5">
              {w.wallet_type === 'app' ? 'All brands' : (w.brand_name ?? 'Brand')}
              <span className="ml-1.5 font-bold tabular-nums">
                {Number(w.balance ?? 0).toLocaleString('en-US')}
              </span>{' '}
              pts
            </span>
          </span>
        );
      })}
    </div>
  );
};

export default LoyaltyWalletChips;

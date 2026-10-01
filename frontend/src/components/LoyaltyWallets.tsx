import React from 'react';
import HoverReveal, { HOVER_CUE } from './HoverReveal';
import { formatPoints } from '../utils/customerDisplay';

export type LoyaltyWallet = {
  wallet_type: 'pos' | 'app';
  brand_id: number | null;
  brand_name: string | null;
  balance: number;
};

/**
 * A customer's loyalty balances.
 *
 * The two kinds of points are different money and are spent in different
 * places, so they are never shown as one undifferentiated figure:
 *  - POS points belong to ONE brand and are earned/redeemed only on that
 *    brand's POS and call-centre orders.
 *  - App points are one balance shared by every brand, earned/redeemed only
 *    on mobile-app orders.
 *
 * Wherever a total appears, the split by kind appears with it, each part led
 * by a solid tag — slate "POS", green "APP", the colours the source pills use
 * for those channels. Where a customer registered (the source pill) says
 * nothing about which wallets they hold.
 */
const KIND = {
  pos: {
    tag: 'POS',
    tagCls: 'bg-[#5A6473] dark:bg-slate-500',
    rowCls: 'border-[#EEEFF2] bg-[#F6F7F9] dark:border-slate-600 dark:bg-slate-700/50',
  },
  app: {
    tag: 'APP',
    tagCls: 'bg-[#16A34A] dark:bg-emerald-600',
    rowCls: 'border-[#D6EEDD] bg-[#F2FAF4] dark:border-emerald-800 dark:bg-emerald-900/30',
  },
} as const;

type Kind = keyof typeof KIND;
const kindOf = (w: LoyaltyWallet): Kind => (w.wallet_type === 'app' ? 'app' : 'pos');
const balanceOf = (w: LoyaltyWallet) => Number(w.balance) || 0;
const sum = (ws: LoyaltyWallet[]) => ws.reduce((s, w) => s + balanceOf(w), 0);
/** POS wallets first (in the order served), the shared app wallet last. */
const ordered = (wallets?: LoyaltyWallet[] | null) => {
  const list = wallets ?? [];
  return [...list.filter((w) => kindOf(w) === 'pos'), ...list.filter((w) => kindOf(w) === 'app')];
};
/** What a wallet's points can be spent at: its brand, or every brand for the app. */
const walletBrand = (w: LoyaltyWallet) => (kindOf(w) === 'app' ? 'All brands' : (w.brand_name ?? 'Brand'));

/** The points a customer holds in total — every wallet, both kinds. */
export function pointsTotal(wallets?: LoyaltyWallet[] | null): number {
  return sum(wallets ?? []);
}

/** The solid "POS" / "APP" tag that leads every balance. */
export const WalletTag: React.FC<{ type: Kind; small?: boolean }> = ({ type, small }) => (
  <span
    data-wallet-tag={type}
    className={`inline-block flex-none font-extrabold leading-none tracking-[.05em] text-white ${
      small ? 'rounded-[4px] px-[5px] py-[2.5px] text-[9px]' : 'rounded-[6px] px-[7px] py-1 text-[10px]'
    } ${KIND[type].tagCls}`}
  >
    {KIND[type].tag}
  </span>
);

/** The customer profile's list: one row per wallet, tagged, with its balance. */
export const LoyaltyWalletList: React.FC<{ wallets?: LoyaltyWallet[] | null }> = ({ wallets }) => {
  const list = ordered(wallets);
  if (list.length === 0) {
    return <p className="text-[13px] text-[#8A92A0] dark:text-slate-400">No loyalty points yet.</p>;
  }
  return (
    <div className="flex flex-col gap-[9px]" aria-label="Loyalty points">
      {list.map((w) => (
        <div
          key={`${w.wallet_type}-${w.brand_id ?? 'shared'}`}
          data-wallet-type={w.wallet_type}
          className={`flex items-center gap-3 rounded-[11px] border px-[13px] py-[11px] ${KIND[kindOf(w)].rowCls}`}
        >
          <WalletTag type={kindOf(w)} />
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-[#374151] dark:text-slate-200">
            {walletBrand(w)}
          </span>
          <span className="text-[15px] font-extrabold tabular-nums text-[#20242C] dark:text-slate-100">
            {formatPoints(balanceOf(w))}
          </span>
        </div>
      ))}
    </div>
  );
};

/**
 * The Customers table's Points cell: the total, and under it what the total
 * is made of.
 *  - one wallet: it is named ("POS · Peperi Co");
 *  - both kinds: each kind's sum ("POS 1,498 · APP 709");
 *  - POS wallets at several brands: how many ("POS · 2 brands").
 * With more than one wallet, hovering the second line lists every wallet.
 */
export const LoyaltyPointsCell: React.FC<{ wallets?: LoyaltyWallet[] | null }> = ({ wallets }) => {
  const list = ordered(wallets).filter((w) => balanceOf(w) > 0);
  if (list.length === 0) return <span className="text-[#C7CCD6] dark:text-slate-600">—</span>;

  const kinds = (['pos', 'app'] as Kind[])
    .map((type) => ({ type, total: sum(list.filter((w) => kindOf(w) === type)) }))
    .filter((k) => k.total > 0);

  return (
    <div>
      <div className="whitespace-nowrap text-[14px] font-extrabold tabular-nums text-[#20242C] dark:text-slate-100">
        {formatPoints(sum(list))} pts
      </div>
      <div className="mt-[3px] whitespace-nowrap text-[11.5px] text-[#8A92A0] dark:text-slate-400">
        {list.length === 1 ? (
          <span data-wallet-type={list[0].wallet_type} className="inline-flex items-center gap-1.5">
            <WalletTag type={kindOf(list[0])} small />
            {walletBrand(list[0])}
          </span>
        ) : (
          <HoverReveal
            underline={false}
            heading={`Point balances (${list.length})`}
            label={`Show all ${list.length} point balances`}
            className="inline-flex items-center gap-2"
            content={
              <>
                <ul className="flex flex-col gap-1.5">
                  {list.map((w) => (
                    <li key={`${w.wallet_type}-${w.brand_id ?? 'shared'}`} className="flex items-center gap-2 text-[12.5px]">
                      <WalletTag type={kindOf(w)} small />
                      <span className="min-w-0 flex-1 truncate text-[#374151] dark:text-slate-200">{walletBrand(w)}</span>
                      <span className="font-extrabold tabular-nums text-[#20242C] dark:text-slate-100">
                        {formatPoints(balanceOf(w))}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 border-t border-[#F1F2F5] pt-2 text-[11px] leading-snug text-[#8A92A0] dark:border-slate-700 dark:text-slate-400">
                  POS points are spent at that brand&rsquo;s POS and call centre. App points are spent on mobile app orders.
                </p>
              </>
            }
          >
            {kinds.length > 1 ? (
              kinds.map((k) => (
                <span key={k.type} data-wallet-type={k.type} className="inline-flex items-center gap-1">
                  <WalletTag type={k.type} small />
                  <span className={`font-bold tabular-nums text-[#5A6473] dark:text-slate-300 ${HOVER_CUE}`}>
                    {formatPoints(k.total)}
                  </span>
                </span>
              ))
            ) : (
              // One kind, several wallets: the sum would only repeat the total
              // above, so say how many brands it is spread over instead.
              <span data-wallet-type={kinds[0].type} className="inline-flex items-center gap-1.5">
                <WalletTag type={kinds[0].type} small />
                <span className={`font-semibold text-[#5A6473] dark:text-slate-300 ${HOVER_CUE}`}>{list.length} brands</span>
              </span>
            )}
          </HoverReveal>
        )}
      </div>
    </div>
  );
};

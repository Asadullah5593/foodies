import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { LoyaltyPointsCell, LoyaltyWalletList, pointsTotal, type LoyaltyWallet } from './LoyaltyWallets';

/**
 * POS points and mobile-app points are spent in different places, so a
 * customer's balances must never read as one undifferentiated figure. Where a
 * customer registered (the "Mobile app" source pill) says nothing about which
 * wallets they hold — the wallet display has to carry that itself, wherever a
 * total is shown.
 */
const pos = (brand: string, balance: number, id = 1): LoyaltyWallet => ({
  wallet_type: 'pos', brand_id: id, brand_name: brand, balance,
});
const app = (balance: number): LoyaltyWallet => ({
  wallet_type: 'app', brand_id: null, brand_name: null, balance,
});

const byType = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>('[data-wallet-type]'));
const tags = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>('[data-wallet-tag]')).map((t) => t.textContent);

describe('LoyaltyWalletList — the customer profile', () => {
  it('has one row per wallet: its tag, what it is for, and its balance', () => {
    const { container } = render(<LoyaltyWalletList wallets={[pos('Wok & Go', 599, 1), pos('Peperi Co', 899, 2), app(709)]} />);
    const rows = byType(container);
    expect(rows.map((r) => r.dataset.walletType)).toEqual(['pos', 'pos', 'app']);
    expect(rows[0].textContent).toBe('POSWok & Go599');
    expect(rows[1].textContent).toBe('POSPeperi Co899');
    expect(rows[2].textContent).toBe('APPAll brands709');
  });

  it('puts POS brands first and the shared app wallet last', () => {
    const { container } = render(<LoyaltyWalletList wallets={[app(7), pos('Fireaway', 4369, 1), pos('Peperi Co', 949, 2)]} />);
    expect(byType(container).map((r) => r.dataset.walletType)).toEqual(['pos', 'pos', 'app']);
    expect(tags(container)).toEqual(['POS', 'POS', 'APP']);
  });

  it('colours the two kinds differently', () => {
    const { container } = render(<LoyaltyWalletList wallets={[pos('Fireaway', 10), app(20)]} />);
    const [posTag, appTag] = Array.from(container.querySelectorAll<HTMLElement>('[data-wallet-tag]'));
    expect(posTag.className).not.toBe(appTag.className);
    expect(appTag.className).toContain('16A34A');
    expect(posTag.className).not.toContain('16A34A');
  });

  it('groups thousands so a large balance is readable', () => {
    const { container } = render(<LoyaltyWalletList wallets={[pos('Fireaway', 30820)]} />);
    expect(byType(container)[0].textContent).toContain('30,820');
  });

  it('says so plainly for a customer with no wallet', () => {
    for (const wallets of [undefined, null, []]) {
      const { container, unmount } = render(<LoyaltyWalletList wallets={wallets} />);
      expect(byType(container)).toHaveLength(0);
      expect(screen.getByText('No loyalty points yet.')).toBeTruthy();
      unmount();
    }
  });
});

describe('LoyaltyPointsCell — one cell of the Customers table', () => {
  it('shows the total, and under it which kind it is', () => {
    const { container } = render(<LoyaltyPointsCell wallets={[pos('Peperi Co', 6648)]} />);
    expect(container.textContent).toBe('6,648 ptsPOSPeperi Co');
    expect(byType(container).map((r) => r.dataset.walletType)).toEqual(['pos']);
  });

  it('names an app-only balance as app points, shared by all brands', () => {
    const { container } = render(<LoyaltyPointsCell wallets={[app(800)]} />);
    expect(container.textContent).toBe('800 ptsAPPAll brands');
  });

  it('never shows a mixed total without the POS / APP split beside it', () => {
    const { container } = render(<LoyaltyPointsCell wallets={[pos('Fireaway', 11248), app(1274)]} />);
    expect(container.textContent).toContain('12,522 pts');
    const split = byType(container);
    expect(split.map((s) => s.dataset.walletType)).toEqual(['pos', 'app']);
    expect(split[0].textContent).toBe('POS11,248');
    expect(split[1].textContent).toBe('APP1,274');
  });

  it('adds POS wallets across brands into the POS part, never into APP', () => {
    const { container } = render(
      <LoyaltyPointsCell wallets={[pos('Wok & Go', 599, 1), pos('Peperi Co', 899, 2), app(709)]} />,
    );
    expect(container.textContent).toContain('2,207 pts');
    const split = byType(container);
    expect(split[0].textContent).toBe('POS1,498');
    expect(split[1].textContent).toBe('APP709');
  });

  it('an app-registered customer holding only POS points shows no APP part', () => {
    const { container } = render(<LoyaltyPointsCell wallets={[pos('Fireaway', 4369, 1), pos('Peperi Co', 949, 2)]} />);
    expect(container.textContent).toContain('5,318 pts');
    expect(tags(container)).toEqual(['POS']);
  });

  it('says how many brands POS points are spread over, instead of repeating the total', () => {
    const { container } = render(<LoyaltyPointsCell wallets={[pos('Fireaway', 4369, 1), pos('Peperi Co', 949, 2)]} />);
    expect(container.textContent).toBe('5,318 ptsPOS2 brands');
    // …and that is the part to hover for the brand-by-brand split.
    const trigger = screen.getByRole('button', { name: 'Show all 2 point balances' });
    expect(container.querySelectorAll('.decoration-dotted').length).toBe(1);
    fireEvent.mouseEnter(trigger);
    expect(Array.from(screen.getByRole('tooltip').querySelectorAll('li')).map((li) => li.textContent)).toEqual([
      'POSFireaway4,369', 'POSPeperi Co949',
    ]);
  });

  it('lists every wallet on hover, and looks hoverable before that', () => {
    const { container } = render(<LoyaltyPointsCell wallets={[pos('Fireaway', 4369, 1), pos('Peperi Co', 949, 2), app(20)]} />);
    const trigger = screen.getByRole('button', { name: 'Show all 3 point balances' });
    expect(trigger.className).toContain('cursor-help');
    // The dotted underline sits on the figures, not on the coloured tags.
    expect(container.querySelectorAll('.decoration-dotted').length).toBe(2);
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.mouseEnter(trigger);
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toContain('Point balances (3)');
    const rows = Array.from(tip.querySelectorAll('li')).map((li) => li.textContent);
    expect(rows).toEqual(['POSFireaway4,369', 'POSPeperi Co949', 'APPAll brands20']);
  });

  it('has nothing to reveal, and no hover cue, when there is a single wallet', () => {
    const { container } = render(<LoyaltyPointsCell wallets={[pos('Peperi Co', 6648)]} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('.decoration-dotted')).toBeNull();
  });

  it('shows a dash, not a zero, for a customer with no points', () => {
    for (const wallets of [undefined, null, [], [pos('Fireaway', 0)]]) {
      const { container, unmount } = render(<LoyaltyPointsCell wallets={wallets} />);
      expect(container.textContent).toBe('—');
      expect(byType(container)).toHaveLength(0);
      unmount();
    }
  });
});

describe('pointsTotal', () => {
  it('adds every wallet, both kinds', () => {
    expect(pointsTotal([pos('Wok & Go', 599, 1), pos('Peperi Co', 899, 2), app(709)])).toBe(2207);
    expect(pointsTotal([])).toBe(0);
    expect(pointsTotal(null)).toBe(0);
  });
});

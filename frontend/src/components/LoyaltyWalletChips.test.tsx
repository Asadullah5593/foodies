import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import LoyaltyWalletChips, { type LoyaltyWalletChip } from './LoyaltyWalletChips';

/**
 * POS points and mobile-app points are spent in different places, so a
 * customer's balances must never read as one undifferentiated figure. Where a
 * customer registered (the "Mobile app" source badge) says nothing about which
 * wallets they hold — the chips have to carry that themselves.
 */
const pos = (brand: string, balance: number, id = 1): LoyaltyWalletChip => ({
  wallet_type: 'pos', brand_id: id, brand_name: brand, balance,
});
const app = (balance: number): LoyaltyWalletChip => ({
  wallet_type: 'app', brand_id: null, brand_name: null, balance,
});

const chips = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>('[data-wallet-type]'));

describe('LoyaltyWalletChips', () => {
  it('tags a POS wallet as POS, with its brand and balance', () => {
    const { container } = render(<LoyaltyWalletChips wallets={[pos('Peperi Co', 949)]} />);
    const [chip] = chips(container);
    expect(chip.dataset.walletType).toBe('pos');
    expect(chip.textContent).toContain('POS');
    expect(chip.textContent).toContain('Peperi Co');
    expect(chip.textContent).toContain('949');
    expect(chip.textContent).not.toContain('APP');
  });

  it('tags the app wallet as APP and as shared by all brands', () => {
    const { container } = render(<LoyaltyWalletChips wallets={[app(500)]} />);
    const [chip] = chips(container);
    expect(chip.dataset.walletType).toBe('app');
    expect(chip.textContent).toContain('APP');
    expect(chip.textContent).toContain('All brands');
    expect(chip.textContent).toContain('500');
  });

  it('gives the two kinds different colours', () => {
    const { container } = render(<LoyaltyWalletChips wallets={[pos('Fireaway', 10), app(20)]} />);
    const [posChip, appChip] = chips(container);
    expect(posChip.className).toContain('indigo');
    expect(posChip.className).not.toContain('emerald');
    expect(appChip.className).toContain('emerald');
    expect(appChip.className).not.toContain('indigo');
  });

  it('shows one chip per wallet — POS brands first, the app wallet last', () => {
    const { container } = render(
      <LoyaltyWalletChips wallets={[app(7), pos('Fireaway', 4369, 1), pos('Peperi Co', 949, 2)]} />,
    );
    expect(chips(container).map((c) => c.dataset.walletType)).toEqual(['pos', 'pos', 'app']);
    expect(chips(container)[0].textContent).toContain('Fireaway');
    expect(chips(container)[1].textContent).toContain('Peperi Co');
  });

  it('says where each kind can be spent', () => {
    const { container } = render(<LoyaltyWalletChips wallets={[pos('Peperi Co', 949), app(5)]} />);
    const [posChip, appChip] = chips(container);
    expect(posChip.title).toMatch(/POS points for Peperi Co/);
    expect(posChip.title).toMatch(/POS and call-centre orders/);
    expect(appChip.title).toMatch(/mobile app orders/i);
  });

  it('groups thousands so a large balance is readable', () => {
    const { container } = render(<LoyaltyWalletChips wallets={[pos('Fireaway', 30820)]} />);
    expect(chips(container)[0].textContent).toContain('30,820');
  });

  it('says zero plainly for a customer with no wallet', () => {
    for (const wallets of [undefined, null, []]) {
      const { container, unmount } = render(<LoyaltyWalletChips wallets={wallets} />);
      expect(chips(container)).toHaveLength(0);
      expect(screen.getByText('Loyalty: 0 pts')).toBeTruthy();
      unmount();
    }
  });
});

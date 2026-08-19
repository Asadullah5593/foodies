import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ManualOfferPicker, { offerTerms } from './ManualOfferPicker';
import { ManualOffer } from '../../../types';

const bogo = (over: Partial<ManualOffer> = {}): ManualOffer => ({
  id: 1,
  name: 'BOGO Coffee',
  type: 'buy_x_get_y',
  value: 0,
  buy_quantity: 1,
  get_quantity: 1,
  get_discount_percent: 100,
  ...over,
});

describe('offerTerms', () => {
  it('reads buy-1-get-1-free off the offer config', () => {
    expect(offerTerms(bogo())).toBe('Buy 1, get 1 free');
  });

  it('says the percentage when the reward is partial', () => {
    expect(offerTerms(bogo({ buy_quantity: 2, get_discount_percent: 50 }))).toBe(
      'Buy 2, get 1 50% off',
    );
  });

  it('has nothing to say about a non-BOGO offer', () => {
    expect(offerTerms(bogo({ type: 'percentage' }))).toBeNull();
  });
});

describe('ManualOfferPicker', () => {
  it('renders nothing when the cashier may activate nothing', () => {
    // The server returns [] without orders:apply-manual-offer, so an
    // unauthorized till must see no control at all rather than an empty box.
    const { container } = render(
      <ManualOfferPicker offers={[]} selectedId={null} onSelect={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('activates an offer and marks it pressed', () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <ManualOfferPicker offers={[bogo()]} selectedId={null} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'BOGO Coffee' }));
    expect(onSelect).toHaveBeenCalledWith(1);

    rerender(
      <ManualOfferPicker offers={[bogo()]} selectedId={1} onSelect={onSelect} />,
    );
    expect(
      screen.getByRole('button', { name: 'BOGO Coffee' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('switches off when the active offer is tapped again', () => {
    const onSelect = vi.fn();
    render(<ManualOfferPicker offers={[bogo()]} selectedId={1} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'BOGO Coffee' }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('shows the amount the quote says it produced', () => {
    render(
      <ManualOfferPicker
        offers={[bogo()]}
        selectedId={1}
        onSelect={vi.fn()}
        appliedAmount={75}
        applied
      />,
    );
    expect(screen.getByText(/BOGO Coffee:\s*−Rs\.?\s?75/i)).toBeTruthy();
  });

  it('explains an activated offer the cart does not yet qualify for', () => {
    // The engine, not the button, decides. A silent zero here reads as a broken
    // button; the cashier needs to know one more coffee is required.
    render(
      <ManualOfferPicker
        offers={[bogo()]}
        selectedId={1}
        onSelect={vi.fn()}
        appliedAmount={0}
        applied={false}
      />,
    );
    expect(screen.getByText(/needs buy 1, get 1 free/i)).toBeTruthy();
  });

  it('shows the server refusal ahead of any amount', () => {
    render(
      <ManualOfferPicker
        offers={[bogo()]}
        selectedId={1}
        onSelect={vi.fn()}
        appliedAmount={0}
        error="You do not have permission to apply this offer."
      />,
    );
    expect(screen.getByText(/do not have permission/i)).toBeTruthy();
  });

  it('does not activate while disabled', () => {
    const onSelect = vi.fn();
    render(
      <ManualOfferPicker offers={[bogo()]} selectedId={null} onSelect={onSelect} disabled />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'BOGO Coffee' }));
    expect(onSelect).not.toHaveBeenCalled();
  });
});

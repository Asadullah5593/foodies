import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  POSOrderTypeProvider,
  useRegisterPOSOrderType,
} from '../../../contexts/POSOrderTypeContext';
import OrderTypeNavTabs from './OrderTypeNavTabs';

const OPTIONS = [
  { value: 'dine_in', label: 'Dine In' },
  { value: 'takeaway', label: 'Takeaway' },
  { value: 'delivery', label: 'Delivery' },
];

const onChange = vi.fn();

/** Stands in for the POS page: publishes the tabs while mounted. */
const Publisher: React.FC<{ value: string | null }> = ({ value }) => {
  useRegisterPOSOrderType(OPTIONS, value, onChange);
  return <div>pos page</div>;
};

/** Mirrors the real tree: navbar and page are siblings under one provider. */
const renderShell = (opts: { value?: string | null; withPage?: boolean } = {}) => {
  const { value = 'delivery', withPage = true } = opts;
  return render(
    <POSOrderTypeProvider>
      <OrderTypeNavTabs />
      {withPage && <Publisher value={value} />}
    </POSOrderTypeProvider>,
  );
};

beforeEach(() => vi.clearAllMocks());

describe('OrderTypeNavTabs', () => {
  it('renders the tabs the POS page publishes', () => {
    renderShell();
    expect(screen.getByRole('radio', { name: /Dine In/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Takeaway/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Delivery/ })).toBeTruthy();
  });

  it('marks the published value as checked', () => {
    renderShell({ value: 'delivery' });
    expect(
      screen.getByRole('radio', { name: /Delivery/ }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      screen.getByRole('radio', { name: /Dine In/ }).getAttribute('aria-checked'),
    ).toBe('false');
  });

  it('reports a tap back to the POS page', () => {
    renderShell({ value: 'delivery' });
    fireEvent.click(screen.getByRole('radio', { name: /Takeaway/ }));
    expect(onChange).toHaveBeenCalledWith('takeaway');
  });

  it('renders nothing when no POS page is mounted', () => {
    renderShell({ withPage: false });
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('disappears when the POS page unmounts, so other screens keep a clean navbar', () => {
    const { rerender } = renderShell({ value: 'delivery' });
    expect(screen.getByRole('radiogroup')).toBeTruthy();
    rerender(
      <POSOrderTypeProvider>
        <OrderTypeNavTabs />
      </POSOrderTypeProvider>,
    );
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('outlines the whole control in red while nothing is selected', () => {
    renderShell({ value: null });
    const idle = screen.getByRole('radiogroup').className;
    expect(idle).toContain('border-foodies-primary');
    expect(idle).not.toContain('border-foodies-primary/25');
  });

  it('softens the outline once a type is picked', () => {
    renderShell({ value: 'dine_in' });
    expect(screen.getByRole('radiogroup').className).toContain(
      'border-foodies-primary/25',
    );
  });

  it('gives the active tab the red underline treatment', () => {
    renderShell({ value: 'dine_in' });
    const active = screen.getByRole('radio', { name: /Dine In/ }).className;
    expect(active).toContain('border-b-[3px]');
    expect(active).toContain('border-foodies-primary');
    expect(active).toContain('text-foodies-primary');
    // inactive tabs keep the underline slot but transparent, so nothing shifts
    const idle = screen.getByRole('radio', { name: /Takeaway/ }).className;
    expect(idle).toContain('border-b-[3px]');
    expect(idle).toContain('border-transparent');
  });
});

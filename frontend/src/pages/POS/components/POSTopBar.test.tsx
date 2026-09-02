import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import POSTopBar from './POSTopBar';

const onSearchChange = vi.fn();
const onBrandChange = vi.fn();
const onBranchChange = vi.fn();

const BRANDS = [
  { id: 25, name: 'Fireaway' },
  { id: 23, name: 'Peperi. Co' },
];
const BRANCHES = [
  { id: 10, name: 'Emporium', code: 'BR-10' },
  { id: 11, name: 'Pine Avenue', code: 'BR-23' },
];

const renderBar = (over: Partial<React.ComponentProps<typeof POSTopBar>> = {}) =>
  render(
    <POSTopBar
      search=""
      onSearchChange={onSearchChange}
      openShift={{ id: 18, shift_number: 'SH-20260705-003' }}
      branchId={10}
      brands={BRANDS}
      selectedBrandId={null}
      onBrandChange={onBrandChange}
      effectiveBranchId={11}
      posBranches={BRANCHES}
      onBranchChange={onBranchChange}
      {...over}
    />,
  );

beforeEach(() => vi.clearAllMocks());

describe('POSTopBar', () => {
  it('shows the shift number badge alongside the open badge', () => {
    renderBar();
    expect(screen.getByText('SH-20260705-003')).toBeTruthy();
    expect(screen.getByText('Shift open')).toBeTruthy();
  });

  it('falls back to the shift id when it has no number', () => {
    renderBar({ openShift: { id: 18 } });
    expect(screen.getByText('#18')).toBeTruthy();
    expect(screen.getByText('Shift open')).toBeTruthy();
  });

  it('shows no shift badges when no shift is open', () => {
    renderBar({ openShift: null });
    expect(screen.queryByText('Shift open')).toBeNull();
    expect(screen.queryByText(/SH-/)).toBeNull();
  });

  it('shows no shift badges without a branch', () => {
    renderBar({ branchId: null });
    expect(screen.queryByText('Shift open')).toBeNull();
  });

  it('carries no Back to Orders button — that lives in the app navbar', () => {
    renderBar();
    expect(screen.queryByRole('button', { name: /Back to Orders/ })).toBeNull();
  });



  // The brand control moved out of this bar into its own tab strip above it;
  // BrandTiles.test.tsx covers it.
  it('carries the branch dropdown', () => {
    renderBar();
    const branch = screen.getByLabelText('Branch') as HTMLSelectElement;
    expect(branch.value).toBe('11');
    fireEvent.change(branch, { target: { value: '10' } });
    expect(onBranchChange).toHaveBeenCalledWith(10);
  });


  it('reports typing in the menu search', () => {
    renderBar();
    fireEvent.change(screen.getByPlaceholderText('Search menu…'), {
      target: { value: 'burger' },
    });
    expect(onSearchChange).toHaveBeenCalledWith('burger');
  });
});

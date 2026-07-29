import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import StaffDiscountPicker from './StaffDiscountPicker';
import { StaffDiscountPreset } from '../../../types';

const pct = (id: number, value: number, name = `${value}% off`): StaffDiscountPreset => ({
  id,
  name,
  discount_type: 'percentage',
  value,
  max_discount_amount: null,
});

const flat = (id: number, value: number, name = `Rs. ${value} off`): StaffDiscountPreset => ({
  id,
  name,
  discount_type: 'flat',
  value,
  max_discount_amount: null,
});

const presets = [pct(1, 5), pct(2, 10), pct(3, 15), flat(4, 200)];

describe('StaffDiscountPicker', () => {
  it('renders a button per preset, percentages and flat amounts labelled differently', () => {
    render(
      <StaffDiscountPicker presets={presets} selectedId={null} onSelect={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: '5%' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '10%' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '15%' })).toBeTruthy();
    // A flat preset must read as money, not as a percentage.
    expect(screen.getByRole('button', { name: /Rs\.?\s?200(\.00)? off/i })).toBeTruthy();
  });

  it('renders nothing when the cashier may grant nothing', () => {
    // Empty list = no permission, no presets, or all above their ceiling. An
    // empty unexplained control on the checkout screen would be worse.
    const { container } = render(
      <StaffDiscountPicker presets={[]} selectedId={null} onSelect={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('selects a preset by id and marks it pressed', () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <StaffDiscountPicker presets={presets} selectedId={null} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '10%' }));
    expect(onSelect).toHaveBeenCalledWith(2);

    rerender(
      <StaffDiscountPicker presets={presets} selectedId={2} onSelect={onSelect} />,
    );
    expect(screen.getByRole('button', { name: '10%' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '5%' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('tapping the selected preset again clears it', () => {
    const onSelect = vi.fn();
    render(<StaffDiscountPicker presets={presets} selectedId={2} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: '10%' }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('shows the applied amount from the quote, not the nominal percentage', () => {
    // The engine applies the percentage to the RUNNING amount, so what the
    // cashier is told must come from the quote rather than value × subtotal.
    render(
      <StaffDiscountPicker
        presets={presets}
        selectedId={2}
        onSelect={vi.fn()}
        appliedAmount={179.1}
      />,
    );
    expect(screen.getByText(/10% off:\s*−Rs\.?\s?179\.10/i)).toBeTruthy();
  });

  it('shows the server refusal instead of an amount when the preset was rejected', () => {
    render(
      <StaffDiscountPicker
        presets={presets}
        selectedId={3}
        onSelect={vi.fn()}
        appliedAmount={0}
        error="That staff discount is above your limit of 10%. Ask a manager to approve it."
      />,
    );
    expect(screen.getByText(/above your limit of 10%/i)).toBeTruthy();
  });

  it('explains a selected preset that produced nothing', () => {
    // Chosen, accepted, but the tenant cap was already spent by earlier stages.
    render(
      <StaffDiscountPicker
        presets={presets}
        selectedId={1}
        onSelect={vi.fn()}
        appliedAmount={0}
      />,
    );
    expect(screen.getByText(/applied nothing/i)).toBeTruthy();
  });

  it('does not fire selection while disabled', () => {
    const onSelect = vi.fn();
    render(
      <StaffDiscountPicker presets={presets} selectedId={null} onSelect={onSelect} disabled />,
    );
    fireEvent.click(screen.getByRole('button', { name: '5%' }));
    expect(onSelect).not.toHaveBeenCalled();
  });
});

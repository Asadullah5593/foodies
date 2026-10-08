import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FilterBar from './FilterBar';

const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });
afterEach(() => setWidth(1024));

const renderBar = (props: Partial<React.ComponentProps<typeof FilterBar>> = {}) =>
  render(
    <FilterBar
      fields={[{ key: 'brand', label: 'Brand', node: <select aria-label="Brand"><option>All brands</option></select> }]}
      chips={[{ key: 'brand', label: 'Fireaway', onRemove: props.chips ? undefined : vi.fn() }]}
      {...props}
    >
      <div data-testid="desktop-filters">desktop filter row</div>
    </FilterBar>,
  );

describe('FilterBar', () => {
  it('renders only the page’s own filters on desktop', () => {
    setWidth(1440);
    renderBar();
    expect(screen.getByTestId('desktop-filters')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Filters/ })).toBeNull();
  });

  it('shows the compact bar on phones: Filters button with a count and the applied chips', () => {
    setWidth(390);
    renderBar();
    expect(screen.queryByTestId('desktop-filters')).toBeNull();
    const btn = screen.getByRole('button', { name: /Filters/ });
    expect(btn).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: 'Remove filter: Fireaway' })).toBeInTheDocument();
  });

  it('removes a filter when its chip is tapped', () => {
    setWidth(390);
    const onRemove = vi.fn();
    renderBar({ chips: [{ key: 'brand', label: 'Fireaway', onRemove }] });
    fireEvent.click(screen.getByRole('button', { name: 'Remove filter: Fireaway' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('opens the sheet with the fields, clears all, and closes from the button and Escape', async () => {
    setWidth(390);
    const onClearAll = vi.fn();
    renderBar({ onClearAll, resultLabel: 'Show 15 orders' });
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
    const dialog = screen.getByRole('dialog', { name: 'Filters' });
    expect(dialog).toHaveTextContent('Brand');
    expect(screen.getByRole('combobox', { name: 'Brand' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Show 15 orders' }));
    // The sheet animates out, so it leaves the tree a moment after the tap.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('renders shortcut chips that apply instead of remove', () => {
    setWidth(390);
    const onSelect = vi.fn();
    renderBar({ chips: [{ key: 'needs', label: 'Needs rider 3', onSelect, tone: 'alert' }] });
    fireEvent.click(screen.getByRole('button', { name: /Needs rider 3/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    // shortcuts don't count as applied filters
    expect(screen.getByRole('button', { name: /^Filters$/ })).toBeInTheDocument();
  });
});

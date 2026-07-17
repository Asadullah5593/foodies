import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, beforeAll } from 'vitest';

import { OrderSeriesChart } from './charts';
import { CHART_COLORS } from '../../../utils/chartColors';
import type { OrderSeriesResponse } from './types';

const BRANDS = [
  { id: 1, name: 'Peperi. Co' },
  { id: 2, name: 'Fireaway' },
  { id: 3, name: 'Wok & Go' },
];

const order = (
  n: number,
  brand_id: number | null,
  brand_name: string | null,
): OrderSeriesResponse['orders'][number] => ({
  order_number: `00${n}`,
  placed_at: `2026-07-1${n}T12:00:00.000Z`,
  total_amount: 100 * n,
  status: 'completed',
  order_type: 'dine_in',
  brand_id,
  brand_name,
});

const MIXED = [
  order(1, 1, 'Peperi. Co'),
  order(2, 2, 'Fireaway'),
  order(3, 3, 'Wok & Go'),
];

// Recharts needs a measured width; jsdom reports 0 for clientWidth.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 280 });
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const legendButton = (name: string) => screen.getByRole('button', { name: new RegExp(name.replace(/[.&]/g, '\\$&')) });

describe('OrderSeriesChart brand focus', () => {
  it('lists one legend entry per brand in the range', () => {
    render(<OrderSeriesChart data={MIXED} theme="light" brands={BRANDS} />);
    for (const b of BRANDS) expect(screen.getByText(b.name)).toBeInTheDocument();
  });

  it('focuses a brand when its legend entry is clicked, and releases on a second click', () => {
    render(<OrderSeriesChart data={MIXED} theme="light" brands={BRANDS} />);
    const fireaway = legendButton('Fireaway');
    expect(fireaway).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('button', { name: 'Show all' })).not.toBeInTheDocument();

    fireEvent.click(fireaway);
    expect(legendButton('Fireaway')).toHaveAttribute('aria-pressed', 'true');
    // The others fade out of the way.
    expect(legendButton('Peperi. Co').className).toMatch(/opacity-40/);
    expect(legendButton('Wok & Go').className).toMatch(/opacity-40/);
    expect(legendButton('Fireaway').className).not.toMatch(/opacity-40/);

    fireEvent.click(legendButton('Fireaway'));
    expect(legendButton('Fireaway')).toHaveAttribute('aria-pressed', 'false');
    expect(legendButton('Peperi. Co').className).not.toMatch(/opacity-40/);
  });

  it('switches focus straight from one brand to another', () => {
    render(<OrderSeriesChart data={MIXED} theme="light" brands={BRANDS} />);
    fireEvent.click(legendButton('Fireaway'));
    fireEvent.click(legendButton('Wok & Go'));
    expect(legendButton('Wok & Go')).toHaveAttribute('aria-pressed', 'true');
    expect(legendButton('Fireaway')).toHaveAttribute('aria-pressed', 'false');
    expect(legendButton('Fireaway').className).toMatch(/opacity-40/);
  });

  it('focuses a brand when its line on the chart is clicked', () => {
    const { container } = render(<OrderSeriesChart data={MIXED} theme="light" brands={BRANDS} />);
    const lines = container.querySelectorAll('path.recharts-line-curve');
    expect(lines.length).toBe(3); // one per brand
    fireEvent.click(lines[1]); // legend order = brand-list order, so this is Fireaway
    expect(legendButton('Fireaway')).toHaveAttribute('aria-pressed', 'true');
  });

  it('offers a "Show all" escape while a brand is focused', () => {
    render(<OrderSeriesChart data={MIXED} theme="light" brands={BRANDS} />);
    fireEvent.click(legendButton('Peperi. Co'));
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(legendButton('Peperi. Co')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('button', { name: 'Show all' })).not.toBeInTheDocument();
  });

  it('gives each brand the colour of its slot in the tenant brand list', () => {
    const { container } = render(<OrderSeriesChart data={MIXED} theme="light" brands={BRANDS} />);
    const swatches = Array.from(container.querySelectorAll('span[style*="background"]'));
    const colors = swatches.map((s) => (s as HTMLElement).style.background);
    // Legend order follows the brand list, so slot 0/1/2 of the palette.
    expect(colors[0]).toContain('rgb(220, 38, 38)'); // CHART_COLORS[0]
    expect(CHART_COLORS[0]).toBe('#DC2626');
    expect(colors[1]).toContain('rgb(37, 99, 235)'); // CHART_COLORS[1]
    expect(colors[2]).toContain('rgb(5, 150, 105)'); // CHART_COLORS[2]
  });

  it('keeps a brand its own colour when the chart is filtered down to it alone', () => {
    // Fireaway alone: still palette slot 1 (blue), not the default red.
    const { container } = render(
      <OrderSeriesChart data={[order(2, 2, 'Fireaway')]} theme="light" brands={BRANDS} />,
    );
    const swatch = container.querySelector('span[style*="background"]') as HTMLElement;
    expect(swatch.style.background).toContain('rgb(37, 99, 235)');
    expect(screen.getByText('Fireaway')).toBeInTheDocument();
    // A lone series has nothing to focus, so it is not a button.
    expect(screen.queryByRole('button', { name: /Fireaway/ })).not.toBeInTheDocument();
  });

  it('labels an order with no brand rather than dropping it', () => {
    render(
      <OrderSeriesChart data={[...MIXED, order(4, null, null)]} theme="light" brands={BRANDS} />,
    );
    const noBrand = legendButton('No brand');
    expect(noBrand).toBeInTheDocument();
    expect(within(noBrand).getByText('No brand')).toBeInTheDocument();
  });
});

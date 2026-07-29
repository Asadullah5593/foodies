import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import POSPillFilters, { PillOption } from './POSPillFilters';

const CATEGORY_PILLS: PillOption[] = [
  { id: null, label: 'All items', count: 23 },
  { id: 1, label: 'Burgers', count: 7 },
  { id: 2, label: 'Sides', count: 4 },
];

const onCategoryChange = vi.fn();

const renderFilters = (over: Partial<React.ComponentProps<typeof POSPillFilters>> = {}) =>
  render(
    <POSPillFilters
      categoryPills={CATEGORY_PILLS}
      selectedCategoryId={null}
      onCategoryChange={onCategoryChange}
      brandChosen
      {...over}
    />,
  );

beforeEach(() => vi.clearAllMocks());

describe('POSPillFilters', () => {
  it('renders a pill per category with its item count', () => {
    renderFilters();
    expect(screen.getByRole('button', { name: /All items/ }).textContent).toContain('23');
    expect(screen.getByRole('button', { name: /Burgers/ }).textContent).toContain('7');
    expect(screen.getByRole('button', { name: /Sides/ }).textContent).toContain('4');
  });

  it('renders nothing at all until a brand is chosen — no label, no hint', () => {
    const { container } = renderFilters({ brandChosen: false });
    expect(container).toBeEmptyDOMElement();
  });

  it('carries no category label or brand hint text', () => {
    renderFilters();
    expect(screen.queryByText(/Category — all/i)).toBeNull();
    expect(screen.queryByText(/Pick a brand/i)).toBeNull();
  });

  it('holds no brand or branch dropdown — those live in the top bar', () => {
    renderFilters();
    expect(screen.queryByLabelText('Brand')).toBeNull();
    expect(screen.queryByLabelText('Branch')).toBeNull();
  });

  it('marks the selected pill pressed and reports taps', () => {
    renderFilters({ selectedCategoryId: 1 });
    expect(
      screen.getByRole('button', { name: /Burgers/ }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: /All items/ }).getAttribute('aria-pressed'),
    ).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: /Sides/ }));
    expect(onCategoryChange).toHaveBeenCalledWith(2);
  });

  it('the "All items" pill passes null, not an id', () => {
    renderFilters({ selectedCategoryId: 1 });
    fireEvent.click(screen.getByRole('button', { name: /All items/ }));
    expect(onCategoryChange).toHaveBeenCalledWith(null);
  });

  it('renders nothing when there are no categories', () => {
    const { container } = renderFilters({ categoryPills: [] });
    expect(container).toBeEmptyDOMElement();
  });
});

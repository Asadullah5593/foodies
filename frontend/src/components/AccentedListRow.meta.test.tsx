import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AccentedList, AccentedListRow } from './AccentedListRow';

/**
 * The optional `meta` column (added for the Customers page's source badge).
 * It must stay inert for the ~20 other lists that never pass it.
 */
const renderRow = (meta?: React.ReactNode) =>
  render(
    <AccentedList>
      <AccentedListRow
        accent="active"
        initial="M"
        title="Mian Umer Sanaullah"
        subtitle={<p>03444474395</p>}
        meta={meta}
        actions={<button type="button">Edit</button>}
      />
    </AccentedList>,
  );

describe('AccentedListRow meta column', () => {
  it('renders the meta node in its own column', () => {
    renderRow(<span data-testid="src">POS</span>);
    const cell = screen.getByTestId('src');
    expect(cell).toBeInTheDocument();
    expect(cell.textContent).toBe('POS');
    // Its own fixed-width column, not inside the title/subtitle block.
    const column = cell.parentElement!;
    expect(column.className).toMatch(/w-24/);
    expect(column.className).toMatch(/flex-shrink-0/);
    expect(column.textContent).toBe('POS');
    expect(column.querySelector('h3')).toBeNull();
  });

  it('keeps the title, subtitle and actions intact alongside it', () => {
    renderRow(<span>Mobile app</span>);
    expect(screen.getByText('Mian Umer Sanaullah')).toBeInTheDocument();
    expect(screen.getByText('03444474395')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByText('Mobile app')).toBeInTheDocument();
  });

  it('renders no extra column when meta is omitted (every other list)', () => {
    const { container } = renderRow(undefined);
    expect(container.querySelector('.w-24')).toBeNull();
    expect(screen.getByText('Mian Umer Sanaullah')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('renders no column for an empty-string meta either', () => {
    const { container } = renderRow('');
    expect(container.querySelector('.w-24')).toBeNull();
  });
});

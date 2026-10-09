import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import RowActionsMenu from './RowActionsMenu';

/** Below lg the row menu is the ⋯ button + bottom sheet; desktop (jsdom's 1024px) keeps the dropdown. */
const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });

describe('RowActionsMenu on a phone', () => {
  afterEach(() => setWidth(1024));

  it('opens a sheet named after the row and runs the chosen action', async () => {
    setWidth(390);
    const view = vi.fn();
    const del = vi.fn();
    render(
      <RowActionsMenu
        ariaLabel="Actions for Abdullah Arshad"
        actions={[
          { label: 'View profile', onSelect: view },
          { label: 'Delete', onSelect: del, danger: true },
        ]}
      />,
    );
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Abdullah Arshad' }));
    const sheet = screen.getByRole('dialog', { name: 'Actions for Abdullah Arshad' });
    expect(within(sheet).getByText('Abdullah Arshad')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Delete' }).className).toContain('text-red-700');
    fireEvent.click(within(sheet).getByRole('button', { name: 'View profile' }));
    expect(view).toHaveBeenCalledTimes(1);
    expect(del).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps the dropdown menu on desktop', () => {
    const view = vi.fn();
    render(<RowActionsMenu ariaLabel="Actions for Zainab" actions={[{ label: 'View profile', onSelect: view }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Zainab' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'View profile' }));
    expect(view).toHaveBeenCalledTimes(1);
  });
});

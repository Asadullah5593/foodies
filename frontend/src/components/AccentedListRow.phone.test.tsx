import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AccentedList, AccentedListRow } from './AccentedListRow';

/**
 * Below lg a list row is a card: the FIRST action stays on it as a full-width button, the rest
 * open from a ⋯ sheet named after the row. Desktop (jsdom's default 1024px) keeps every action
 * inline — see AccentedListRow.meta.test.tsx.
 */
const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });

const renderRow = (actions: React.ReactNode, extra: Partial<React.ComponentProps<typeof AccentedListRow>> = {}) =>
  render(
    <AccentedList>
      <AccentedListRow
        accent="active"
        initial="P"
        title="Peperi. Co"
        subtitle={<p>Delivery fee: Rs. 200.00</p>}
        statusLabel="active"
        actions={actions}
        {...extra}
      />
    </AccentedList>,
  );

describe('AccentedListRow on a phone', () => {
  beforeEach(() => setWidth(390));
  afterEach(() => setWidth(1024));

  it('keeps the first action on the card and folds the rest into a ⋯ sheet', async () => {
    const onEdit = vi.fn();
    const onInactive = vi.fn();
    const onDelete = vi.fn();
    renderRow(
      <>
        <button type="button" onClick={onEdit}>Edit</button>
        <button type="button" onClick={onInactive}>Set inactive</button>
        <button type="button" className="text-red-700" onClick={onDelete}>Delete</button>
      </>,
    );
    expect(screen.getByTestId('list-card')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set inactive' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'More actions for Peperi. Co' }));
    const sheet = screen.getByRole('dialog', { name: 'Actions for Peperi. Co' });
    expect(within(sheet).getByText('Peperi. Co')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Set inactive' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Delete' })).toBeInTheDocument();

    // A tap runs the page's own handler and closes the sheet.
    fireEvent.click(within(sheet).getByRole('button', { name: 'Set inactive' }));
    expect(onInactive).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
    // The sheet leaves after its exit animation.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Actions for Peperi. Co' })).toBeNull());
  });

  it('shows no ⋯ button for a single action, and none at all without actions', () => {
    const { unmount } = renderRow(<button type="button">Edit</button>);
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /More actions/ })).toBeNull();
    unmount();
    renderRow(<></>);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the status pill, the extra chips and the mobile subtitle in place of the desktop one', () => {
    renderRow(<button type="button">Edit</button>, {
      chips: <span>Online open</span>,
      mobileSubtitle: <div data-testid="grid">Rs. 200.00</div>,
    });
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('Online open')).toBeInTheDocument();
    expect(screen.getByTestId('grid')).toBeInTheDocument();
    expect(screen.queryByText('Delivery fee: Rs. 200.00')).toBeNull();
  });

  it('Cancel closes the sheet without running anything', async () => {
    const onDelete = vi.fn();
    renderRow(
      <>
        <button type="button">Edit</button>
        <button type="button" onClick={onDelete}>Delete</button>
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Peperi. Co' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onDelete).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

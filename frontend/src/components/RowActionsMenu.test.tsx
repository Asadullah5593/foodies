import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import RowActionsMenu from './RowActionsMenu';

/**
 * One "Actions" button per table row. The row itself opens a detail page on
 * click, so the menu must never let its own clicks reach the row.
 */
const setup = (actions = [
  { label: 'Orders', onSelect: vi.fn() },
  { label: 'Vouchers', onSelect: vi.fn() },
  { label: 'Edit', onSelect: vi.fn() },
  { label: 'Delete', onSelect: vi.fn(), danger: true },
]) => {
  const onRowClick = vi.fn();
  render(
    <table>
      <tbody>
        <tr onClick={onRowClick}>
          <td>
            <RowActionsMenu actions={actions} ariaLabel="Actions for Abdullah" />
          </td>
        </tr>
      </tbody>
    </table>,
  );
  return { actions, onRowClick, button: screen.getByRole('button', { name: 'Actions for Abdullah' }) };
};

describe('RowActionsMenu', () => {
  it('is closed until asked for', () => {
    const { button } = setup();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens to every action it was given, in order', () => {
    const { button } = setup();
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Orders', 'Vouchers', 'Edit', 'Delete']);
  });

  it('runs the chosen action and closes', () => {
    const { button, actions } = setup();
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Vouchers' }));
    expect(actions[1].onSelect).toHaveBeenCalledTimes(1);
    expect(actions[0].onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('never opens the row it sits in', () => {
    const { button, onRowClick } = setup();
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('closes on Escape and on a click elsewhere', () => {
    const { button } = setup();
    fireEvent.click(button);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(button);
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes rather than drift when the page scrolls', () => {
    const { button } = setup();
    fireEvent.click(button);
    fireEvent.scroll(window);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('renders nothing when there is nothing to do', () => {
    render(<RowActionsMenu actions={[]} ariaLabel="Nothing" />);
    expect(screen.queryByRole('button', { name: 'Nothing' })).toBeNull();
  });
});

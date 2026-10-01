import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import HoverReveal from './HoverReveal';

/**
 * "+2 more" in a table cell used to keep its list in a native `title`: it
 * worked, but nothing told the user to hover. This component has to make that
 * obvious (dotted underline, help cursor), open at once, and work without a
 * mouse — on focus and on a tap.
 */
const setup = () => {
  const onRowClick = vi.fn();
  render(
    <table>
      <tbody>
        <tr onClick={onRowClick}>
          <td>
            Fireaway{' '}
            <HoverReveal
              heading="Brands (3)"
              label="Show all 3 brands"
              content={<ul><li>Fireaway</li><li>Peperi Co</li><li>Wok &amp; Go</li></ul>}
            >
              +2 more
            </HoverReveal>
          </td>
        </tr>
      </tbody>
    </table>,
  );
  return { onRowClick, trigger: screen.getByRole('button', { name: 'Show all 3 brands' }) };
};

describe('HoverReveal', () => {
  it('shows only the trigger until asked', () => {
    const { trigger } = setup();
    expect(trigger.textContent).toBe('+2 more');
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('looks hoverable before anyone hovers: dotted underline and a help cursor', () => {
    const { trigger } = setup();
    expect(trigger.className).toContain('decoration-dotted');
    expect(trigger.className).toContain('underline');
    expect(trigger.className).toContain('cursor-help');
  });

  it('opens the full list on hover and closes when the pointer leaves', () => {
    const { trigger } = setup();
    fireEvent.mouseEnter(trigger);
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toContain('Brands (3)');
    expect(tip.textContent).toContain('Peperi Co');
    expect(tip.textContent).toContain('Wok & Go');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.getAttribute('aria-describedby')).toBe(tip.id);
    fireEvent.mouseLeave(trigger);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('opens on keyboard focus too', () => {
    const { trigger } = setup();
    fireEvent.focus(trigger);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.blur(trigger);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('opens on a tap, where there is no hover, and a second tap closes it', () => {
    const { trigger } = setup();
    fireEvent.click(trigger);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('never opens the row it sits in', () => {
    const { trigger, onRowClick } = setup();
    fireEvent.click(trigger);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('closes on Escape, on a tap elsewhere, and when the page scrolls', () => {
    const { trigger } = setup();
    fireEvent.mouseEnter(trigger);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.mouseEnter(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.mouseEnter(trigger);
    fireEvent.scroll(window);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('does not rely on a native title, which is what hid the list before', () => {
    const { trigger } = setup();
    expect(trigger.hasAttribute('title')).toBe(false);
  });
});

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import SegToggle from './SegToggle';

/** Below lg the On / Off segments become one switch; desktop (jsdom's 1024px) keeps the two buttons. */
const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });

describe('SegToggle', () => {
  afterEach(() => setWidth(1024));

  it('is a switch on a phone: one control, aria-checked, a tap flips it', () => {
    setWidth(390);
    const onChange = vi.fn();
    render(<SegToggle on={false} onChange={onChange} ariaLabel="Auto-print invoices" />);
    const sw = screen.getByRole('switch', { name: 'Auto-print invoices' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(sw).toHaveTextContent('Off');
    expect(screen.queryByRole('group')).toBeNull();
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('reads On and flips to off when on', () => {
    setWidth(768);
    const onChange = vi.fn();
    render(<SegToggle on onChange={onChange} />);
    const sw = screen.getByRole('switch');
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(sw).toHaveTextContent('On');
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('keeps the two segments on desktop', () => {
    const onChange = vi.fn();
    render(<SegToggle on={false} onChange={onChange} ariaLabel="Loyalty" />);
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByRole('group', { name: 'Loyalty' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'On' }));
    expect(onChange).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Off' }));
    expect(onChange).toHaveBeenCalledWith(false);
  });
});

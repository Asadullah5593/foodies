import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import ResponsiveSelect from './ResponsiveSelect';

const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });

const Picker: React.FC<{ onChange: (v: string) => void }> = ({ onChange }) => (
  <ResponsiveSelect aria-label="Category" value="" onChange={(e) => onChange(e.target.value)} className="w-full">
    <option value="">All categories</option>
    <option value="1">Burgers</option>
    <option value="2">Old Specials (Inactive)</option>
  </ResponsiveSelect>
);

describe('ResponsiveSelect', () => {
  afterEach(() => setWidth(1024));

  it('is the native select on desktop, options untouched', () => {
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);
    const select = screen.getByRole('combobox', { name: 'Category' });
    expect(select.tagName).toBe('SELECT');
    expect(screen.getByRole('option', { name: 'Old Specials (Inactive)' })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: '1' } });
    expect(onChange).toHaveBeenCalledWith('1');
  });

  it('is a searchable dropdown below lg: the inactive option carries a badge instead of the text suffix', () => {
    setWidth(390);
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);
    expect(screen.queryByRole('combobox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Category/ }));
    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
    const inactive = screen.getByRole('option', { name: /Old Specials/ });
    expect(inactive).toHaveTextContent('Inactive');
    expect(inactive.textContent).not.toContain('(Inactive)');
    expect(screen.getByRole('option', { name: 'Burgers' }).textContent).not.toContain('Inactive');
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Burgers' }));
    expect(onChange).toHaveBeenCalledWith('1');
  });
});

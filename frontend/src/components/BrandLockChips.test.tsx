import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BrandLockChips from './BrandLockChips';

const BRANDS = [
  { id: 3, name: 'Peperi Co' },
  { id: 7, name: 'Fireaway' },
  { id: 9, name: 'Loranzo', is_active: false },
];

const setup = (value: number[] = []) => {
  const onChange = vi.fn();
  render(<BrandLockChips brands={BRANDS} value={value} onChange={onChange} />);
  return onChange;
};

describe('BrandLockChips', () => {
  it('shows All brands selected when nothing is locked', () => {
    setup([]);
    expect(screen.getByText('All brands').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/Peperi Co/).getAttribute('aria-pressed')).toBe('false');
  });

  it('adds a second brand instead of replacing the first — the whole point', () => {
    const onChange = setup([3]);
    fireEvent.click(screen.getByText(/Fireaway/));
    expect(onChange).toHaveBeenCalledWith([3, 7]);
  });

  it('removes a brand that is already on', () => {
    const onChange = setup([3, 7]);
    fireEvent.click(screen.getByText(/Peperi Co/));
    expect(onChange).toHaveBeenCalledWith([7]);
  });

  it('All brands clears the lock rather than being a brand of its own', () => {
    const onChange = setup([3, 7]);
    expect(screen.getByText('All brands').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByText('All brands'));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('turning off the last brand falls back to all brands, never to none', () => {
    const onChange = setup([3]);
    fireEvent.click(screen.getByText(/Peperi Co/));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('keeps the ids sorted so an unchanged selection compares equal', () => {
    const onChange = setup([7]);
    fireEvent.click(screen.getByText(/Peperi Co/));
    expect(onChange).toHaveBeenCalledWith([3, 7]);
  });

  it('marks a deactivated brand', () => {
    setup([]);
    expect(screen.getByText(/Loranzo/).textContent).toContain('(Inactive)');
    expect(screen.getByText(/Peperi Co/).textContent).not.toContain('Inactive');
  });

  it('ignores clicks when disabled', () => {
    const onChange = vi.fn();
    render(<BrandLockChips brands={BRANDS} value={[3]} onChange={onChange} disabled />);
    fireEvent.click(screen.getByText(/Fireaway/));
    expect(onChange).not.toHaveBeenCalled();
  });
});

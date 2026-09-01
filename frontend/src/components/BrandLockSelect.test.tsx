import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import BrandLockSelect from './BrandLockSelect';

const BRANDS = [
  { id: 3, name: 'Peperi Co' },
  { id: 7, name: 'Fireaway' },
  { id: 9, name: 'Loranzo', is_active: false },
];

const setup = (value: number[] = [], disabled = false) => {
  const onChange = vi.fn();
  render(
    <BrandLockSelect
      brands={BRANDS}
      value={value}
      onChange={onChange}
      disabled={disabled}
      ariaLabel="Brands for Ali"
    />,
  );
  return onChange;
};
const trigger = () => screen.getByRole('button', { name: 'Brands for Ali' });
const openPanel = () => {
  fireEvent.click(trigger());
  return screen.getByRole('listbox');
};

describe('BrandLockSelect — the trigger stays one line', () => {
  it('summarises rather than listing, so a table row keeps its height', () => {
    setup([]);
    expect(trigger().textContent).toContain('All brands');
    // Nothing is rendered until it is opened.
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('names a single brand, and counts more than one', () => {
    const { unmount } = render(
      <BrandLockSelect brands={BRANDS} value={[3]} onChange={() => {}} ariaLabel="one" />,
    );
    expect(screen.getByRole('button', { name: 'one' }).textContent).toContain('Peperi Co');
    unmount();
    render(<BrandLockSelect brands={BRANDS} value={[3, 7]} onChange={() => {}} ariaLabel="two" />);
    const t = screen.getByRole('button', { name: 'two' });
    expect(t.textContent).toContain('2 brands');
    // The names are still reachable without opening it.
    expect(t.getAttribute('title')).toBe('Peperi Co, Fireaway');
  });
});

describe('BrandLockSelect — choosing brands', () => {
  it('adds a second brand instead of replacing the first — the whole point', () => {
    const onChange = setup([3]);
    const panel = openPanel();
    fireEvent.click(within(panel).getByText(/Fireaway/));
    expect(onChange).toHaveBeenCalledWith([3, 7]);
  });

  it('removes a brand that is already on', () => {
    const onChange = setup([3, 7]);
    fireEvent.click(within(openPanel()).getByText(/Peperi Co/));
    expect(onChange).toHaveBeenCalledWith([7]);
  });

  it('All brands clears the lock rather than being a brand of its own', () => {
    const onChange = setup([3, 7]);
    const panel = openPanel();
    expect(within(panel).getByText('All brands').closest('[role="option"]')!.getAttribute('aria-selected')).toBe('false');
    fireEvent.click(within(panel).getByText('All brands'));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('turning off the last brand falls back to all brands, never to none', () => {
    const onChange = setup([3]);
    fireEvent.click(within(openPanel()).getByText(/Peperi Co/));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('keeps the ids sorted so an unchanged selection compares equal', () => {
    const onChange = setup([7]);
    fireEvent.click(within(openPanel()).getByText(/Peperi Co/));
    expect(onChange).toHaveBeenCalledWith([3, 7]);
  });

  it('stays open while several brands are ticked', () => {
    setup([]);
    const panel = openPanel();
    fireEvent.click(within(panel).getByText(/Peperi Co/));
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('ticks the rows that are already chosen', () => {
    setup([3, 7]);
    const panel = openPanel();
    const optionFor = (name: RegExp | string) =>
      within(panel).getByText(name).closest('[role="option"]')!;
    expect(optionFor(/Peperi Co/).getAttribute('aria-selected')).toBe('true');
    expect(optionFor(/Loranzo/).getAttribute('aria-selected')).toBe('false');
  });

  it('marks a deactivated brand', () => {
    setup([]);
    const panel = openPanel();
    expect(within(panel).getByText(/Loranzo/).textContent).toContain('(Inactive)');
    expect(within(panel).getByText(/Peperi Co/).textContent).not.toContain('Inactive');
  });
});

describe('BrandLockSelect — dismissal and disabled', () => {
  it('closes on Escape', () => {
    setup([]);
    openPanel();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes on an outside click', () => {
    setup([]);
    openPanel();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('does not open when disabled', () => {
    const onChange = setup([3], true);
    fireEvent.click(trigger());
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});

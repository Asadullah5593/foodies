import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import BrandTiles, { brandMonogram } from './BrandTiles';

const BRANDS = [
  { id: 25, name: 'Fireaway', logo_url: 'https://cdn.example/fireaway.png' },
  { id: 23, name: 'Peperi Co', logo_url: null },
  { id: 27, name: 'Loranzo', logo_url: 'https://cdn.example/loranzo.png', is_active: false },
];

const COUNTS = { 25: 42, 23: 34, 27: 51 };

const setup = (selectedBrandId: number | null = null, brands = BRANDS) => {
  const onBrandChange = vi.fn();
  render(
    <BrandTiles
      brands={brands}
      selectedBrandId={selectedBrandId}
      onBrandChange={onBrandChange}
      itemCounts={COUNTS}
    />,
  );
  return { onBrandChange, group: screen.getByRole('group', { name: 'Brand' }) };
};

describe('BrandTiles — behaviour matches the dropdown it replaced', () => {
  it('puts All first and selects it, so nothing changes until a brand is tapped', () => {
    const { group } = setup(null);
    const buttons = within(group).getAllByRole('button');
    expect(buttons[0].textContent).toContain('All brands');
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
  });

  it('tapping a brand filters to it', () => {
    const { onBrandChange, group } = setup(null);
    fireEvent.click(within(group).getByLabelText('Fireaway'));
    expect(onBrandChange).toHaveBeenCalledWith(25);
  });

  it('tapping All clears the filter', () => {
    const { onBrandChange, group } = setup(25);
    fireEvent.click(within(group).getByLabelText('All brands'));
    expect(onBrandChange).toHaveBeenCalledWith(null);
  });

  it('marks which brand is showing', () => {
    const { group } = setup(23);
    expect(within(group).getByLabelText('Peperi Co').getAttribute('aria-pressed')).toBe('true');
    expect(within(group).getByLabelText('Fireaway').getAttribute('aria-pressed')).toBe('false');
  });
});

describe('BrandTiles — the logo, and what stands in for it', () => {
  it('draws the logo uploaded in Brands', () => {
    const { group } = setup();
    const img = within(group).getByLabelText('Fireaway').querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://cdn.example/fireaway.png');
  });

  it('prefixes a disk-driver path, which would otherwise never load', () => {
    // Uploads land on S3 (absolute) or the local disk driver (a path relative
    // to the API). Rendering the raw value works for the first and silently
    // fails for the second — every such brand would fall back to its name and
    // the feature would look like it did nothing.
    render(
      <BrandTiles
        brands={[{ id: 1, name: 'Local', logo_url: '/uploads/brands/a.png' }]}
        selectedBrandId={null}
        onBrandChange={() => {}}
      />,
    );
    const img = screen.getByLabelText('Local').querySelector('img');
    expect(img?.getAttribute('src')).toMatch(/^https?:\/\/.+\/uploads\/brands\/a\.png$/);
  });

  it('shows the brand NAME when no logo was uploaded', () => {
    const { group } = setup();
    const tile = within(group).getByLabelText('Peperi Co');
    expect(tile.querySelector('img')).toBeNull();
    expect(tile.textContent).toContain('PC');
  });

  it('falls back to the name when the logo fails to load', () => {
    // A dead CDN URL and a missing upload look identical from the till, and a
    // broken-image glyph is worse than either.
    const { group } = setup();
    const tile = within(group).getByLabelText('Fireaway');
    fireEvent.error(tile.querySelector('img')!);
    expect(within(group).getByLabelText('Fireaway').querySelector('img')).toBeNull();
    expect(within(group).getByLabelText('Fireaway').textContent).toContain('FI');
  });

  it('a broken logo on one brand does not affect another', () => {
    const { group } = setup();
    fireEvent.error(within(group).getByLabelText('Fireaway').querySelector('img')!);
    expect(within(group).getByLabelText(/Loranzo/).querySelector('img')).not.toBeNull();
  });

  it('names the brand for a screen reader whether or not a logo is drawn', () => {
    const { group } = setup();
    expect(within(group).getByLabelText('Fireaway')).toBeTruthy();
    expect(within(group).getByLabelText('Peperi Co')).toBeTruthy();
  });
});

describe('BrandTiles — deactivated brands', () => {
  it('greys a deactivated brand and says so', () => {
    const { group } = setup();
    const tile = within(group).getByLabelText('Loranzo (inactive)');
    expect(tile.className).toContain('grayscale');
    expect(tile.className).toContain('opacity-45');
  });

  it('leaves a live brand alone', () => {
    const { group } = setup();
    expect(within(group).getByLabelText('Fireaway').className).not.toContain('grayscale');
  });

  it('still lets a deactivated brand be selected — an open order must stay editable', () => {
    const { onBrandChange, group } = setup();
    fireEvent.click(within(group).getByLabelText('Loranzo (inactive)'));
    expect(onBrandChange).toHaveBeenCalledWith(27);
  });
});

describe('BrandTiles — item counts, as the design asks', () => {
  it('shows how many items each brand holds', () => {
    const { group } = setup();
    expect(within(group).getByLabelText('Fireaway').textContent).toContain('42 items');
    expect(within(group).getByLabelText('Peperi Co').textContent).toContain('34 items');
  });

  it('the All tab totals them', () => {
    const { group } = setup();
    expect(within(group).getByLabelText('All brands').textContent).toContain('127 items');
  });

  it('an explicit total wins — the menu may hold items with no brand', () => {
    const onBrandChange = vi.fn();
    render(
      <BrandTiles
        brands={BRANDS}
        selectedBrandId={null}
        onBrandChange={onBrandChange}
        itemCounts={COUNTS}
        totalItemCount={130}
      />,
    );
    expect(screen.getByLabelText('All brands').textContent).toContain('130 items');
  });

  it('reads zero rather than blank for a brand with nothing on this order type', () => {
    const onBrandChange = vi.fn();
    render(
      <BrandTiles brands={BRANDS} selectedBrandId={null} onBrandChange={onBrandChange} />,
    );
    expect(screen.getByLabelText('Fireaway').textContent).toContain('0 items');
  });
});

describe('brandMonogram', () => {
  it('takes the initials of the first two words', () => {
    expect(brandMonogram('Wok & Go')).toBe('WG');
    expect(brandMonogram('Peperi Co')).toBe('PC');
  });

  it('takes two letters from a single-word name', () => {
    expect(brandMonogram('Loranzo')).toBe('LO');
  });

  it('survives punctuation and empties rather than rendering nothing', () => {
    expect(brandMonogram('  ')).toBe('?');
    expect(brandMonogram('')).toBe('?');
    expect(brandMonogram("O'Briens Pizza")).toBe('OP');
  });
});

describe('BrandTiles — a till that sells one brand', () => {
  const ONE = [{ id: 27, name: 'Loranzo', logo_url: null }];
  const one = (selectedBrandId: number | null = null) => {
    const onBrandChange = vi.fn();
    render(
      <BrandTiles
        brands={ONE}
        selectedBrandId={selectedBrandId}
        onBrandChange={onBrandChange}
        itemCounts={{ 27: 51 }}
      />,
    );
    return { onBrandChange, group: screen.getByRole('group', { name: 'Brand' }) };
  };

  it('names the brand instead of showing nothing at all', () => {
    // The dropdown hid itself entirely for a one-brand till, so the cashier was
    // never told which brand they were selling.
    const { group } = one();
    expect(within(group).getByLabelText('Loranzo')).toBeTruthy();
    expect(within(group).getByLabelText('Loranzo').textContent).toContain('51 items');
  });

  it('shows it as selected even though nothing is filtered', () => {
    const { group } = one(null);
    expect(within(group).getByLabelText('Loranzo').getAttribute('aria-pressed')).toBe('true');
  });

  it('drops the All tab, which would name the same menu twice', () => {
    const { group } = one();
    expect(within(group).queryByLabelText('All brands')).toBeNull();
    expect(within(group).getAllByRole('button')).toHaveLength(1);
  });

  it('still offers All once there is more than one brand to choose between', () => {
    const onBrandChange = vi.fn();
    render(
      <BrandTiles
        brands={[...ONE, { id: 23, name: 'Peperi Co', logo_url: null }]}
        selectedBrandId={null}
        onBrandChange={onBrandChange}
      />,
    );
    const group = screen.getByRole('group', { name: 'Brand' });
    expect(within(group).getByLabelText('All brands').getAttribute('aria-pressed')).toBe('true');
    expect(within(group).getByLabelText('Loranzo').getAttribute('aria-pressed')).toBe('false');
  });
});

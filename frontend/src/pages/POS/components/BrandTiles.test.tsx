import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import BrandTiles from './BrandTiles';

const BRANDS = [
  { id: 25, name: 'Fireaway', logo_url: 'https://cdn.example/fireaway.png' },
  { id: 23, name: 'Peperi Co', logo_url: null },
  { id: 27, name: 'Loranzo', logo_url: 'https://cdn.example/loranzo.png', is_active: false },
];

const setup = (selectedBrandId: number | null = null, brands = BRANDS) => {
  const onBrandChange = vi.fn();
  render(
    <BrandTiles brands={brands} selectedBrandId={selectedBrandId} onBrandChange={onBrandChange} />,
  );
  return { onBrandChange, group: screen.getByRole('group', { name: 'Brand' }) };
};

describe('BrandTiles — behaviour matches the dropdown it replaced', () => {
  it('puts All first and selects it, so nothing changes until a brand is tapped', () => {
    const { group } = setup(null);
    const buttons = within(group).getAllByRole('button');
    expect(buttons[0].textContent).toBe('All');
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
  });

  it('tapping a brand filters to it', () => {
    const { onBrandChange, group } = setup(null);
    fireEvent.click(within(group).getByLabelText('Fireaway'));
    expect(onBrandChange).toHaveBeenCalledWith(25);
  });

  it('tapping All clears the filter', () => {
    const { onBrandChange, group } = setup(25);
    fireEvent.click(within(group).getByText('All'));
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
    expect(tile.textContent).toBe('Peperi Co');
  });

  it('falls back to the name when the logo fails to load', () => {
    // A dead CDN URL and a missing upload look identical from the till, and a
    // broken-image glyph is worse than either.
    const { group } = setup();
    const tile = within(group).getByLabelText('Fireaway');
    fireEvent.error(tile.querySelector('img')!);
    expect(within(group).getByLabelText('Fireaway').querySelector('img')).toBeNull();
    expect(within(group).getByLabelText('Fireaway').textContent).toBe('Fireaway');
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

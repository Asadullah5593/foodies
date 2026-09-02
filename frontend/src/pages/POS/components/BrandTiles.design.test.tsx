import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import BrandTiles from './BrandTiles';

/**
 * The design was handed over as a mockup with exact values. These pin the ones
 * a cashier would notice going wrong — the selected tab's red underline and
 * tinted row, the 52px tile, the 38px mark inside it — so a refactor cannot
 * quietly drift away from what was signed off.
 */
// jsdom serialises hex colours as rgb(), so the design's values are pinned in
// that form: #DC2A2A is rgb(220, 42, 42) and #EEF0F3 is rgb(238, 240, 243).
describe('BrandTiles — matches the handed-over design', () => {
  const setup = (selectedBrandId: number | null) => {
    render(
      <BrandTiles
        brands={[
          { id: 23, name: 'Peperi Co', logo_url: 'https://cdn/x.png' },
          { id: 27, name: 'Loranzo', logo_url: null },
        ]}
        selectedBrandId={selectedBrandId}
        onBrandChange={() => {}}
        itemCounts={{ 23: 34, 27: 51 }}
      />,
    );
    return screen.getByRole('group', { name: 'Brand' });
  };

  it('is a full-width tab strip, each tab sharing the width', () => {
    const group = setup(null);
    expect(group.className).toContain('items-stretch');
    within(group)
      .getAllByRole('button')
      .forEach((b) => expect(b.className).toContain('flex-1'));
  });

  it('underlines the selected tab in red and tints its row', () => {
    const group = setup(27);
    const on = within(group).getByLabelText('Loranzo');
    expect(on.getAttribute('style')).toContain('3px solid rgb(220, 42, 42)');
    expect(on.className).toContain('bg-[#FCEEEE]');

    const off = within(group).getByLabelText('Peperi Co');
    expect(off.getAttribute('style')).toContain('transparent');
    expect(off.className).not.toContain('bg-[#FCEEEE]');
  });

  it('fills the All tile red when it is the one selected', () => {
    const all = within(setup(null)).getByLabelText('All brands');
    expect(all.querySelector('span')?.getAttribute('style')).toContain('rgb(220, 42, 42)');
  });

  it('greys the All tile when a brand is selected instead', () => {
    const all = within(setup(27)).getByLabelText('All brands');
    expect(all.querySelector('span')?.getAttribute('style')).toContain('rgb(238, 240, 243)');
  });

  it('keeps the tile 52px and the mark inside it 38px', () => {
    const group = setup(null);
    const tile = within(group).getByLabelText('Peperi Co').querySelector('span');
    expect(tile?.className).toContain('h-[52px]');
    expect(tile?.className).toContain('rounded-[13px]');
    const img = within(group).getByLabelText('Peperi Co').querySelector('img');
    expect(img?.getAttribute('class')).toContain('h-[38px]');
    expect(img?.getAttribute('class')).toContain('rounded-[10px]');
  });

  it('spells the brand name out beside the mark, with its item count', () => {
    const group = setup(null);
    const tab = within(group).getByLabelText('Loranzo');
    expect(tab.textContent).toContain('Loranzo');
    expect(tab.textContent).toContain('51 items');
  });
});

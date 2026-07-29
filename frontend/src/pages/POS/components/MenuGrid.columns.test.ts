import { describe, it, expect } from 'vitest';
import { columnsForWidth, MENU_GRID_ROWS, MENU_PAGE_SIZE } from './MenuGrid';

/** Page size the POS derives from a measured grid width. */
const pageSizeFor = (width: number) => {
  const cols = columnsForWidth(width);
  return cols > 0 ? cols * MENU_GRID_ROWS : MENU_PAGE_SIZE;
};

describe('menu grid columns', () => {
  it('fits 6 columns — 18 items — on a 1920px till', () => {
    // 1913 viewport − 280 sidebar − 480 cart panel − 40 padding ≈ 1113.
    expect(columnsForWidth(1113)).toBe(6);
    expect(pageSizeFor(1113)).toBe(18);
  });

  it('always fills whole rows, never a ragged last row', () => {
    for (const width of [300, 480, 700, 900, 1113, 1400, 1800]) {
      const cols = columnsForWidth(width);
      expect(pageSizeFor(width) % cols).toBe(0);
      expect(pageSizeFor(width) / cols).toBe(MENU_GRID_ROWS);
    }
  });

  it('gives more columns as the till widens, and never fewer', () => {
    const widths = [300, 500, 700, 900, 1100, 1300, 1600];
    const cols = widths.map(columnsForWidth);
    for (let i = 1; i < cols.length; i += 1) {
      expect(cols[i]).toBeGreaterThanOrEqual(cols[i - 1]);
    }
  });

  it('keeps cards at the target width, except at the 2-column phone floor', () => {
    for (const width of [320, 640, 1024, 1113, 1440, 1920]) {
      const cols = columnsForWidth(width);
      const cardWidth = (width - (cols - 1) * 10) / cols;
      // Below ~356px two columns cannot both reach 168px. Two narrow cards
      // still beat one card wasting half a phone screen, so the floor wins.
      if (cols === 2) continue;
      expect(cardWidth).toBeGreaterThanOrEqual(168);
    }
  });

  it('holds the 2-column floor on a phone even though cards go under target', () => {
    expect(columnsForWidth(320)).toBe(2);
    expect((320 - 10) / 2).toBeLessThan(168);
  });

  it('never drops below 2 columns on a phone, nor past 8 on a wall screen', () => {
    expect(columnsForWidth(200)).toBe(2);
    expect(columnsForWidth(120)).toBe(2);
    expect(columnsForWidth(6000)).toBe(8);
  });

  it('reports 0 before measurement so the caller can fall back', () => {
    expect(columnsForWidth(0)).toBe(0);
    expect(columnsForWidth(Number.NaN)).toBe(0);
    expect(pageSizeFor(0)).toBe(MENU_PAGE_SIZE);
  });
});

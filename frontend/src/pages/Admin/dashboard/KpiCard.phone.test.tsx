import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import KpiCard from './KpiCard';

/**
 * Below lg the dashboard cards sit two to a row, and a large amount ("Rs. 11167400.73") cannot
 * break inside its digits — it ran out of the Revenue card on a 360px phone. The figure now
 * shrinks until it fits; desktop keeps its fixed 22px.
 *
 * jsdom has no layout, so the card's text box is simulated: 105px wide, with the text's width
 * proportional to its font size (130px at 22px — what a 360px phone measured).
 */
const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });

const BOX = 105;
const TEXT_AT_22 = 130;
const fontPx = (el: HTMLElement) => parseFloat(el.style.fontSize || '22');

let restore: Array<() => void> = [];
const fakeLayout = () => {
  const proto = HTMLElement.prototype;
  const cw = Object.getOwnPropertyDescriptor(proto, 'clientWidth');
  const sw = Object.getOwnPropertyDescriptor(proto, 'scrollWidth');
  Object.defineProperty(proto, 'clientWidth', { configurable: true, get: () => BOX });
  Object.defineProperty(proto, 'scrollWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.tagName === 'P' && /\d{7}/.test(this.textContent ?? '')
        ? Math.ceil((TEXT_AT_22 * fontPx(this)) / 22)
        : BOX;
    },
  });
  restore = [
    () => (cw ? Object.defineProperty(proto, 'clientWidth', cw) : delete (proto as unknown as Record<string, unknown>).clientWidth),
    () => (sw ? Object.defineProperty(proto, 'scrollWidth', sw) : delete (proto as unknown as Record<string, unknown>).scrollWidth),
  ];
};

describe('KpiCard figure on a narrow card', () => {
  beforeEach(fakeLayout);
  afterEach(() => {
    restore.forEach((r) => r());
    setWidth(1024);
  });

  it('shrinks a long amount on a phone until it fits the card', () => {
    setWidth(360);
    render(<KpiCard label="Revenue" value="Rs. 11167400.73" />);
    const figure = screen.getByText('Rs. 11167400.73');
    const size = fontPx(figure);
    expect(size).toBeLessThan(22);
    expect(size).toBeGreaterThanOrEqual(12);
    expect(Math.ceil((TEXT_AT_22 * size) / 22)).toBeLessThanOrEqual(BOX);
  });

  it('leaves a figure that already fits at full size', () => {
    setWidth(360);
    render(<KpiCard label="Orders" value="8167" />);
    expect(screen.getByText('8167').style.fontSize).toBe('');
  });

  it('never touches the figure on desktop', () => {
    setWidth(1280);
    render(<KpiCard label="Revenue" value="Rs. 11167400.73" />);
    expect(screen.getByText('Rs. 11167400.73').style.fontSize).toBe('');
  });
});

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import TableScroll from './TableScroll';

const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });
afterEach(() => setWidth(1024));

/** jsdom has no layout: give the wrapper a wider content than its box. */
const fakeGeometry = (el: HTMLElement, scrollWidth: number, clientWidth: number) => {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth });
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth });
};

describe('TableScroll', () => {
  it('on desktop renders exactly the plain wrapper with the page’s classes', () => {
    setWidth(1440);
    const { container } = render(
      <TableScroll className="overflow-x-auto rounded-xl">
        <table data-testid="t" />
      </TableScroll>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toBe('overflow-x-auto rounded-xl');
    expect(wrapper.firstElementChild).toBe(screen.getByTestId('t'));
    expect(screen.queryByTestId('scroll-more-right')).toBeNull();
  });

  it('on a phone fades the edge that still has columns, following the scroll position', () => {
    setWidth(390);
    render(
      <TableScroll>
        <table data-testid="t" />
      </TableScroll>,
    );
    const scroller = screen.getByTestId('t').parentElement as HTMLElement;
    fakeGeometry(scroller, 900, 358);
    scroller.scrollLeft = 0;
    fireEvent.scroll(scroller);
    expect(screen.getByTestId('scroll-more-right')).toBeInTheDocument();
    expect(screen.queryByTestId('scroll-more-left')).toBeNull();

    scroller.scrollLeft = 900 - 358;
    fireEvent.scroll(scroller);
    expect(screen.queryByTestId('scroll-more-right')).toBeNull();
    expect(screen.getByTestId('scroll-more-left')).toBeInTheDocument();
  });

  it('shows no fade when the table fits', () => {
    setWidth(390);
    render(
      <TableScroll>
        <table data-testid="t" />
      </TableScroll>,
    );
    const scroller = screen.getByTestId('t').parentElement as HTMLElement;
    fakeGeometry(scroller, 300, 358);
    fireEvent.scroll(scroller);
    expect(screen.queryByTestId('scroll-more-right')).toBeNull();
    expect(screen.queryByTestId('scroll-more-left')).toBeNull();
  });
});

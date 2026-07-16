import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ScrollToTopButton from './ScrollToTopButton';

/** Give an element fake scroll metrics (jsdom reports 0 for everything). */
const setMetrics = (el: Element, scrollHeight: number, clientHeight: number) => {
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
};

const resize = () => act(() => void window.dispatchEvent(new Event('resize')));

beforeEach(() => {
  setMetrics(document.documentElement, 0, 0);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('ScrollToTopButton', () => {
  it('stays hidden while nothing scrolls', () => {
    render(<ScrollToTopButton />);
    expect(screen.queryByRole('button', { name: 'Scroll to top' })).not.toBeInTheDocument();
  });

  it('appears when an inner overflow container gets a scrollbar, and scrolls IT to top', async () => {
    // Mimic the Layout: <main overflow-auto> → page root → button.
    const { container } = render(
      <div style={{ overflowY: 'auto' }} data-testid="scroller">
        <div>
          <ScrollToTopButton />
        </div>
      </div>,
    );
    const scroller = container.firstElementChild as HTMLElement;
    const scrollTo = vi.fn();
    (scroller as HTMLElement & { scrollTo: typeof scrollTo }).scrollTo = scrollTo;

    // Content grows past the container box → scrollbar exists → button shows.
    setMetrics(scroller, 1200, 400);
    resize();
    const btn = await screen.findByRole('button', { name: 'Scroll to top' });

    fireEvent.click(btn);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('falls back to the window when only the page itself scrolls', async () => {
    const winScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    render(<ScrollToTopButton />);
    expect(screen.queryByRole('button', { name: 'Scroll to top' })).not.toBeInTheDocument();

    // The document grows beyond the viewport → window scrollbar.
    setMetrics(document.documentElement, 2000, 800);
    resize();
    const btn = await screen.findByRole('button', { name: 'Scroll to top' });

    fireEvent.click(btn);
    expect(winScroll).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('hides again when the scrollbar goes away', async () => {
    render(<ScrollToTopButton />);
    setMetrics(document.documentElement, 2000, 800);
    resize();
    await screen.findByRole('button', { name: 'Scroll to top' });

    setMetrics(document.documentElement, 800, 800);
    resize();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Scroll to top' })).not.toBeInTheDocument(),
    );
  });

  it('ignores overflow-auto ancestors that are NOT actually overflowing (window scrolls instead)', async () => {
    // Mimic Kitchen Display: a min-h-screen page whose overflow-auto <main>
    // grows with content and never overflows — the window scrolls.
    const winScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const { container } = render(
      <div style={{ overflowY: 'auto' }}>
        <ScrollToTopButton />
      </div>,
    );
    const main = container.firstElementChild as HTMLElement;
    setMetrics(main, 900, 900); // grows with content: no inner scrollbar
    setMetrics(document.documentElement, 2000, 800); // window scrollbar

    resize();
    const btn = await screen.findByRole('button', { name: 'Scroll to top' });
    fireEvent.click(btn);
    expect(winScroll).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });
});

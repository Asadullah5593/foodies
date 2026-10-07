import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { readViewport, useViewport, VIEWPORT_BREAKPOINTS } from './useViewport';

// setupTests.ts installs a matchMedia that evaluates min/max-width against window.innerWidth.
const setWidth = (width: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
};

afterEach(() => setWidth(1024));

describe('useViewport', () => {
  it('reports desktop from 1024px up — the web view the mobile work must not change', () => {
    setWidth(VIEWPORT_BREAKPOINTS.lg);
    expect(readViewport()).toMatchObject({ isDesktop: true, isTablet: false, isPhone: false });
    setWidth(1440);
    expect(readViewport().isDesktop).toBe(true);
  });

  it('reports tablet between 640 and 1023', () => {
    setWidth(VIEWPORT_BREAKPOINTS.sm);
    expect(readViewport()).toMatchObject({ isTablet: true, isDesktop: false, isPhone: false });
    setWidth(1023);
    expect(readViewport().isTablet).toBe(true);
  });

  it('reports phone below 640', () => {
    setWidth(639);
    expect(readViewport()).toMatchObject({ isPhone: true, isTablet: false, isDesktop: false });
    setWidth(360);
    expect(readViewport().isPhone).toBe(true);
  });

  it('works as a hook and matches the direct read', () => {
    setWidth(390);
    const { result } = renderHook(() => useViewport());
    expect(result.current.isPhone).toBe(true);
    expect(result.current).toEqual(readViewport());
  });

  it('defaults to desktop when matchMedia is unavailable', () => {
    const original = window.matchMedia;
    // @ts-expect-error — simulate an environment without matchMedia
    window.matchMedia = undefined;
    try {
      expect(readViewport()).toMatchObject({ isDesktop: true, isPhone: false, isTablet: false });
    } finally {
      window.matchMedia = original;
    }
  });
});

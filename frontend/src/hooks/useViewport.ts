import { useEffect, useState } from 'react';

/**
 * Viewport classes for the mobile/tablet layer.
 *
 * The thresholds are Tailwind's `sm` (640) and `lg` (1024), so a JS branch and a `max-lg:` /
 * `max-sm:` class always agree:
 *
 *   phone    < 640        (`max-sm:`)
 *   tablet   640 – 1023   (`sm:max-lg:`)
 *   desktop  ≥ 1024       the web view — mobile work never changes what renders here
 *
 * Outside a browser (SSR, jsdom without a matchMedia mock) it reports desktop, so existing
 * component tests keep seeing the desktop tree.
 */
export const VIEWPORT_BREAKPOINTS = { sm: 640, lg: 1024 } as const;

export interface Viewport {
  isPhone: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  /** Primary input is touch (phones, tablets): autofocusing an input would pop the keyboard. */
  isCoarsePointer: boolean;
}

// Same cut as Tailwind's `max-sm` (`not all and (min-width: 640px)`).
const PHONE_QUERY = `(max-width: ${VIEWPORT_BREAKPOINTS.sm - 0.02}px)`;
const DESKTOP_QUERY = `(min-width: ${VIEWPORT_BREAKPOINTS.lg}px)`;
const COARSE_QUERY = '(pointer: coarse)';

const DESKTOP: Viewport = { isPhone: false, isTablet: false, isDesktop: true, isCoarsePointer: false };

const canQuery = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

export function readViewport(): Viewport {
  if (!canQuery()) return DESKTOP;
  try {
    const isPhone = window.matchMedia(PHONE_QUERY).matches;
    const isDesktop = !isPhone && window.matchMedia(DESKTOP_QUERY).matches;
    return {
      isPhone,
      isTablet: !isPhone && !isDesktop,
      isDesktop,
      isCoarsePointer: window.matchMedia(COARSE_QUERY).matches,
    };
  } catch {
    return DESKTOP;
  }
}

const same = (a: Viewport, b: Viewport) =>
  a.isPhone === b.isPhone && a.isTablet === b.isTablet && a.isDesktop === b.isDesktop && a.isCoarsePointer === b.isCoarsePointer;

export function useViewport(): Viewport {
  const [viewport, setViewport] = useState<Viewport>(readViewport);

  useEffect(() => {
    if (!canQuery()) return;
    const lists = [PHONE_QUERY, DESKTOP_QUERY, COARSE_QUERY].map((q) => window.matchMedia(q));
    const update = () => setViewport((prev) => {
      const next = readViewport();
      return same(prev, next) ? prev : next;
    });
    for (const list of lists) {
      if (typeof list.addEventListener === 'function') list.addEventListener('change', update);
      else list.addListener(update);
    }
    update();
    return () => {
      for (const list of lists) {
        if (typeof list.removeEventListener === 'function') list.removeEventListener('change', update);
        else list.removeListener(update);
      }
    };
  }, []);

  return viewport;
}

export default useViewport;

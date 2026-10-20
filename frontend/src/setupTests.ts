// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// jsdom has no matchMedia. This stand-in answers min-width / max-width queries from
// window.innerWidth (jsdom default 1024 → desktop, so existing tests see the desktop tree) and
// says "no" to everything else (pointer, colour scheme). Responsive tests set window.innerWidth.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  const evaluate = (query: string): boolean => {
    const min = /min-width:\s*([\d.]+)px/.exec(query);
    const max = /max-width:\s*([\d.]+)px/.exec(query);
    if (!min && !max) return false;
    const width = window.innerWidth;
    return (!min || width >= parseFloat(min[1])) && (!max || width <= parseFloat(max[1]));
  };
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      get matches() {
        return evaluate(query);
      },
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

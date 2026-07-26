import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { renderInvoiceHtml } from './renderInvoice';
import { InvoiceVM, InvoiceLayout, InvoiceTemplateConfig } from './types';

/**
 * Live invoice preview used by the template editor. Renders the SAME html/css
 * the print popup uses (so preview == printout), and — when a field is toggled —
 * briefly highlights the affected receipt line in yellow.
 *
 * Each config-gated element carries a `data-field="<configKey>"` attribute
 * (added in renderInvoice.ts). On a toggle change the parent bumps `flashNonce`
 * with the changed `flashKey`; we flash every matching element. When a field is
 * turned OFF its line would normally disappear before it can flash, so we
 * momentarily force it back on for the flash, then drop the override so it
 * collapses again — the line lights up on the way out, matching the design.
 */

/** Keys whose visual effect lives inside another field's row (no own element). */
const FLASH_ALIAS: Record<string, keyof InvoiceTemplateConfig> = {
  showTaxRate: 'showTax', // the rate is part of the Tax row
  showDiscountName: 'showDiscountTotal', // the code is part of the combined Discount row
};

type FlashState = { key: string; nonce: number; reveal: boolean };

const LiveInvoicePreview: React.FC<{
  data: InvoiceVM;
  layout: InvoiceLayout;
  config: InvoiceTemplateConfig;
  flashKey: string | null;
  flashNonce: number;
}> = ({ data, layout, config, flashKey, flashNonce }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [flash, setFlash] = useState<FlashState | null>(null);

  // React to a new flash signal from the parent (config already updated).
  useEffect(() => {
    if (!flashKey || !flashNonce) return;
    const alias = FLASH_ALIAS[flashKey];
    const target = (alias ?? flashKey) as string;
    // Force the field back on for the flash only when it just turned off AND it
    // owns its own row (aliased fields live inside a row that is still present).
    const reveal = !alias && !config[flashKey as keyof InvoiceTemplateConfig];
    setFlash({ key: target, nonce: flashNonce, reveal });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashNonce]);

  const effectiveConfig: InvoiceTemplateConfig =
    flash?.reveal ? { ...config, [flash.key]: true } : config;
  const { html, css } = renderInvoiceHtml(data, layout, effectiveConfig);

  // After the (possibly revealed) DOM paints, highlight the matching line(s).
  useLayoutEffect(() => {
    if (!flash) return;
    const root = containerRef.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll(`[data-field="${flash.key}"]`));
    els.forEach((el) => el.classList.add('inv-flash'));
    const t = window.setTimeout(() => {
      els.forEach((el) => el.classList.remove('inv-flash'));
      setFlash((f) => (f && f.nonce === flash.nonce ? null : f));
    }, 950);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flash?.nonce]);

  const flashCss = `
    .inv-root .inv-flash, .inv-root .inv-flash > td, .inv-root .inv-flash > .l, .inv-root .inv-flash > .r {
      background: #FFF4D1 !important;
      border-radius: 3px;
      color: #000 !important;
    }
    .inv-root [data-field] { transition: background .18s ease; }
  `;

  return (
    <div className="flex justify-center overflow-x-auto rounded-lg bg-white p-4 text-black shadow-inner">
      <style dangerouslySetInnerHTML={{ __html: css + flashCss }} />
      <div ref={containerRef} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
};

export default LiveInvoicePreview;

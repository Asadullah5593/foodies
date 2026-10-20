import React, { useLayoutEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useViewport } from '../../../hooks/useViewport';

/** The smallest a figure is shrunk to on a narrow card before it is allowed to overflow. */
const MIN_FIT_PX = 12;

interface KpiCardProps {
  label: string;
  value: string;
  sublabel?: string;
  delta?: number | null;
  accent?: string; // tailwind text color class for the value
  index?: number;
  loading?: boolean;
}

const KpiCard: React.FC<KpiCardProps> = ({
  label,
  value,
  sublabel,
  delta,
  accent = 'text-gray-900 dark:text-slate-100',
  index = 0,
  loading = false,
}) => {
  const { isDesktop } = useViewport();
  const valueRef = useRef<HTMLParagraphElement>(null);

  // Below lg the cards sit two to a row, and a large amount ("Rs. 11167400.73") cannot break
  // inside its digits, so it ran out of the card. Shrink the figure until its longest line fits
  // the card; "Rs." may still wrap onto its own line. Desktop keeps the fixed 22px.
  useLayoutEffect(() => {
    const el = valueRef.current;
    if (!el) return;
    if (isDesktop) {
      el.style.fontSize = '';
      return;
    }
    const fit = () => {
      el.style.fontSize = '';
      let size = parseFloat(getComputedStyle(el).fontSize) || 22;
      for (let i = 0; i < 4 && el.scrollWidth > el.clientWidth + 0.5 && size > MIN_FIT_PX; i++) {
        size = Math.max(MIN_FIT_PX, Math.floor(((size * el.clientWidth) / el.scrollWidth) * 10) / 10);
        el.style.fontSize = `${size}px`;
      }
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    // Refit when the card's width changes (rotation, sidebar). Height changes are the fit itself.
    let lastWidth = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === lastWidth) return;
      lastWidth = el.clientWidth;
      fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [value, isDesktop, loading]);

  const shell =
    'h-full rounded-[14px] border border-gray-200 bg-white px-[17px] py-[15px] shadow-[0_6px_18px_rgba(15,23,42,0.04)] dark:border-slate-700 dark:bg-slate-800';

  if (loading) {
    return (
      <div className={shell}>
        <div className="animate-pulse space-y-3">
          <div className="h-3 w-20 rounded bg-gray-200 dark:bg-slate-700" />
          <div className="h-6 w-28 rounded bg-gray-200 dark:bg-slate-700" />
          <div className="h-3 w-16 rounded bg-gray-200 dark:bg-slate-700" />
        </div>
      </div>
    );
  }

  const hasDelta = delta != null && Number.isFinite(delta);
  const up = hasDelta && (delta as number) >= 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className="h-full"
    >
      <div className={shell}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-gray-400 dark:text-slate-500">
            {label}
          </h3>
          {hasDelta && (
            <span
              className={`inline-flex flex-none items-center gap-0.5 text-[11px] font-extrabold ${
                up
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              }`}
              title="vs previous period"
            >
              {up ? '▲' : '▼'} {Math.abs(delta as number).toFixed(1)}%
            </span>
          )}
        </div>
        <p ref={valueRef} className={`mt-2 text-[22px] font-black tabular-nums ${accent}`}>
          {value}
        </p>
        {/* Falls back to an nbsp — a plain space would collapse and lose the line */}
        <p className="mt-0.5 text-[11.5px] text-gray-400 dark:text-slate-500">
          {sublabel ?? '\u00a0'}
        </p>
      </div>
    </motion.div>
  );
};

export default KpiCard;

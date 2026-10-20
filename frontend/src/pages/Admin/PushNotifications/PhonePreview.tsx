import React, { useState } from 'react';
import { sampleText, VISIBLE_BODY, VISIBLE_TITLE } from './pushText';

interface Props {
  title: string;
  body: string;
  imageUrl?: string | null;
  tokens: Array<{ key: string; example: string }>;
  /** Small label above the phones, e.g. "Version B". */
  caption?: string;
}

// The phone mock is light in both themes, so it uses fixed colours: the app's
// global dark-mode rules recolour text-gray-* (index.css).
/**
 * How the notification looks on a lock screen, with an Android / iPhone
 * switch. Placeholders are filled with example values
 * so "{first_name}" reads as "Ali". The image shows on Android only — the
 * iPhone app has no notification extension.
 */
const PhonePreview: React.FC<Props> = ({ title, body, imageUrl, tokens, caption }) => {
  const [tab, setTab] = useState<'android' | 'ios'>('android');
  const t = sampleText(title, tokens) || 'Your title';
  const b = sampleText(body, tokens) || 'Your message';
  const longTitle = t.length > VISIBLE_TITLE;
  const longBody = b.length > VISIBLE_BODY;

  const android = (
    <div className="rounded-[22px] bg-gradient-to-b from-slate-700 to-slate-900 p-3 shadow-inner" data-testid="preview-android">
      <div className="mb-2 flex justify-between px-1 text-[10px] font-semibold text-white/80">
        <span>7:00</span>
        <span>Android</span>
      </div>
      <div className="rounded-2xl bg-white/95 p-3 text-left shadow-lg">
        <div className="mb-1 flex items-center gap-1.5 text-[10.5px] text-[#6B7280]">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[9px] font-black text-white">F</span>
          <span>Foodies</span>
          <span>· now</span>
        </div>
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-bold text-[#111827]">{t}</p>
            <p className="line-clamp-2 text-[12px] leading-snug text-[#4B5563]">{b}</p>
          </div>
          {imageUrl && (
            <img src={imageUrl} alt="" className="h-10 w-10 flex-none rounded-md object-cover" onError={(e) => (e.currentTarget.style.display = 'none')} />
          )}
        </div>
      </div>
    </div>
  );

  const ios = (
    <div className="rounded-[22px] bg-gradient-to-b from-indigo-400 to-purple-700 p-3 shadow-inner" data-testid="preview-ios">
      <div className="mb-2 text-center text-[22px] font-light leading-none text-white">7:00</div>
      <div className="rounded-2xl bg-white/80 p-3 text-left shadow-lg backdrop-blur">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-md bg-red-600 text-[11px] font-black text-white">F</span>
          <div className="min-w-0 flex-1">
            <div className="flex justify-between text-[10.5px] text-[#6B7280]">
              <span className="font-semibold uppercase tracking-wide">Foodies</span>
              <span>now</span>
            </div>
            <p className="truncate text-[13px] font-semibold text-[#111827]">{t}</p>
            <p className="line-clamp-4 text-[12px] leading-snug text-[#374151]">{b}</p>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div>
      {caption && <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-slate-500">{caption}</p>}
      <div className="mb-2 flex gap-1" role="tablist" aria-label="Phone">
        {(['android', 'ios'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`rounded-lg px-3 py-1 text-[12px] font-semibold ${tab === k ? 'bg-gray-800 text-white dark:bg-slate-200 dark:text-slate-900' : 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300'}`}
          >
            {k === 'android' ? 'Android' : 'iPhone'}
          </button>
        ))}
      </div>
      <div className="mx-auto max-w-[300px]">{tab === 'android' ? android : ios}</div>
      {(longTitle || longBody || imageUrl) && (
        <ul className="mt-2 space-y-1 text-[11.5px] leading-snug text-amber-700 dark:text-amber-400">
          {longTitle && <li>• The title is long — phones may cut it after about {VISIBLE_TITLE} characters.</li>}
          {longBody && <li>• Long text is cut on the lock screen; the full message shows when it is opened.</li>}
          {imageUrl && <li>• The image shows on Android phones only.</li>}
        </ul>
      )}
    </div>
  );
};

export default PhonePreview;

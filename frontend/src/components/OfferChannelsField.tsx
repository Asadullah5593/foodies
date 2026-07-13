import React from 'react';

export const ALL_OFFER_CHANNELS = ['pos', 'app', 'web', 'kiosk'] as const;
export type OfferChannel = (typeof ALL_OFFER_CHANNELS)[number];

const CHANNEL_LABELS: Record<OfferChannel, string> = {
  pos: 'POS',
  app: 'Customer App',
  web: 'Website',
  kiosk: 'Kiosk',
};

/** null/empty from the API = every channel. */
export const channelsToForm = (channels?: string[] | null): string[] =>
  channels && channels.length > 0 ? channels : [...ALL_OFFER_CHANNELS];

/** All four selected = no restriction → send null. */
export const channelsToApi = (selected: string[]): string[] | null =>
  selected.length === 0 || selected.length === ALL_OFFER_CHANNELS.length ? null : selected;

interface Props {
  value: string[];
  onChange: (channels: string[]) => void;
}

/** Checkbox group deciding where an offer applies (POS / app / web / kiosk). */
const OfferChannelsField: React.FC<Props> = ({ value, onChange }) => {
  const toggle = (ch: string) =>
    onChange(value.includes(ch) ? value.filter((c) => c !== ch) : [...value, ch]);
  const check = (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3,8.5 6.5,12 13,4.5" />
    </svg>
  );
  return (
    <div>
      <span className="mb-2.5 block text-[13px] font-semibold text-gray-700">Applies on</span>
      <div className="flex flex-wrap gap-2.5">
        {ALL_OFFER_CHANNELS.map((ch) => {
          const on = value.includes(ch);
          return (
            <button
              key={ch}
              type="button"
              onClick={() => toggle(ch)}
              className={`inline-flex items-center gap-2 rounded-full border-[1.5px] px-[15px] py-[9px] text-[13.5px] font-semibold transition-colors ${
                on ? 'border-red-600 bg-red-50 text-red-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              <span
                className={`flex h-4 w-4 flex-none items-center justify-center rounded-[5px] border-[1.5px] ${
                  on ? 'border-red-600 bg-red-600' : 'border-gray-300 bg-white'
                }`}
              >
                {on && check}
              </span>
              {CHANNEL_LABELS[ch]}
            </button>
          );
        })}
      </div>
      <p className="mt-2.5 text-[12.5px] text-gray-500">
        Untick a channel to hide the offer there (e.g. POS only, or app only). All ticked = everywhere.
      </p>
    </div>
  );
};

export default OfferChannelsField;

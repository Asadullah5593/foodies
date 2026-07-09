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
  return (
    <div>
      <span className="block text-sm font-medium text-gray-700 mb-1">Applies on</span>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {ALL_OFFER_CHANNELS.map((ch) => (
          <label key={ch} className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={value.includes(ch)} onChange={() => toggle(ch)} />
            {CHANNEL_LABELS[ch]}
          </label>
        ))}
      </div>
      <p className="text-xs text-gray-400 mt-1">
        Untick a channel to hide the offer there (e.g. POS only, or app only). All ticked = everywhere.
      </p>
    </div>
  );
};

export default OfferChannelsField;

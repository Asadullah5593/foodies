import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import DeliveryPinMap from './DeliveryPinMap';
import { LatLngLiteral, ResolvedPlace } from '../utils/googlePlaces';

interface DeliveryLocationModalProps {
  open: boolean;
  /** The committed place. Its coordinates seed the draft each time we open. */
  place: ResolvedPlace;
  /** Cashier accepted the pin — commit these coordinates. */
  onConfirm: (position: LatLngLiteral) => void;
  /** Dismissed: the committed coordinates stand, the adjustment is dropped. */
  onCancel: () => void;
}

/**
 * Full-screen map for placing the delivery pin.
 *
 * Portaled to <body> on purpose: this opens from inside the Checkout modal,
 * whose animated panel carries a transform, and a `fixed` element inside a
 * transformed ancestor is contained by that ancestor instead of the viewport —
 * it would render as a box inside Checkout rather than full screen.
 *
 * Draft-only: dragging never touches the order. The address's own coordinates
 * are already committed when the suggestion is picked, so dismissing this is
 * always safe and can never leave a delivery order without a location.
 */
const DeliveryLocationModal: React.FC<DeliveryLocationModalProps> = ({
  open,
  place,
  onConfirm,
  onCancel,
}) => {
  const [draft, setDraft] = useState<LatLngLiteral>({
    lat: place.latitude,
    lng: place.longitude,
  });
  // Through a ref so the key shield below doesn't re-register on every render.
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  // Reopen starts from what is committed, so a dismissed adjustment never
  // reappears later.
  useEffect(() => {
    if (open) setDraft({ lat: place.latitude, lng: place.longitude });
  }, [open, place.latitude, place.longitude]);

  useEffect(() => {
    if (!open) return undefined;

    // The POS binds hotkeys on window: Escape closes Checkout, Ctrl+Enter
    // submits the order, Enter adds a menu item, '/' focuses the menu search.
    // While this owns the screen none of them may fire — capture at window runs
    // before every one of them, so stopping propagation here shields the lot.
    // Escape then dismisses this overlay and nothing else; confirming stays a
    // deliberate button press, with no keyboard path that commits a pin.
    const onKeyDown = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancelRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);

    // Drop focus from the address box so the docked on-screen keyboard hides —
    // it sits at z-[100] and would otherwise cover the action bar.
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      active.blur();
    }

    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open]);

  if (!open) return null;

  // No separate backdrop element: the panel covers the viewport, so a backdrop
  // would only ever be an invisible click target. z-[70] clears the Checkout
  // modal (z-50) and stays under the on-screen keyboard (z-[100]).
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Set delivery location"
      className="fixed inset-0 z-[70] flex flex-col bg-foodies-surface dark:bg-slate-900"
    >
      <div className="flex items-start justify-between gap-3 border-b border-foodies-border px-4 py-3 dark:border-slate-700">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foodies-textPrimary dark:text-slate-100">
            Set delivery location
          </h2>
          <p className="truncate text-sm text-foodies-textSecondary dark:text-slate-400">{place.address}</p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close map"
          className="flex-none rounded-lg px-3 py-2 text-2xl leading-none text-foodies-textSecondary hover:bg-foodies-surfaceMuted dark:text-slate-400 dark:hover:bg-slate-800"
        >
          ×
        </button>
      </div>

      {/* min-h-0 lets this flex child actually shrink, so the map gets real
          height on the first frame — Google reads the container size once. */}
      <div className="min-h-0 flex-1">
        <DeliveryPinMap
          latitude={draft.lat}
          longitude={draft.lng}
          onMove={setDraft}
          className="h-full w-full bg-foodies-surfaceMuted dark:bg-slate-800"
        />
      </div>

      <div className="flex flex-col gap-3 border-t border-foodies-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-slate-700">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foodies-textPrimary dark:text-slate-100">
            Drag the pin, or tap the map, to where the rider should stop.
          </p>
          <p className="font-mono text-xs text-foodies-textSecondary dark:text-slate-400">
            {`Pin: ${draft.lat.toFixed(6)}, ${draft.lng.toFixed(6)}`}
          </p>
        </div>
        <div className="flex flex-none gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[48px] flex-1 rounded-xl border border-foodies-border px-5 text-sm font-semibold text-foodies-textPrimary hover:bg-foodies-surfaceMuted sm:flex-none dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(draft)}
            className="min-h-[48px] flex-1 rounded-xl bg-foodies-primary px-6 text-sm font-semibold text-white hover:opacity-90 sm:flex-none"
          >
            Use this location
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default DeliveryLocationModal;

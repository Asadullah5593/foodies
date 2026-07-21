import React, { useEffect, useRef, useState } from 'react';
import { LatLngLiteral, RawMap, RawMarker, loadMapsSdk, onMapsAuthFailure } from '../utils/googlePlaces';

const key = (p: LatLngLiteral) => `${p.lat},${p.lng}`;

interface DeliveryPinMapProps {
  latitude: number;
  longitude: number;
  /** Fired when the cashier drags the pin or taps a new spot. */
  onMove: (position: LatLngLiteral) => void;
  /** Sizing for the map surface. Google needs it to have real dimensions already. */
  className?: string;
}

/**
 * Confirmation map for the picked delivery address, with a draggable pin.
 *
 * Google usually returns the centre of a street or block, which in Pakistan can
 * be a few hundred metres from the gate — dragging lets the cashier correct it
 * to where the rider should actually stop.
 *
 * Rendering a map bills the Dynamic Maps SKU, so this mounts only after an
 * address is picked: one map load per delivery order, not per keystroke.
 */
const DeliveryPinMap: React.FC<DeliveryPinMapProps> = ({
  latitude,
  longitude,
  onMove,
  className = 'h-full w-full bg-foodies-surfaceMuted',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<RawMap | null>(null);
  const markerRef = useRef<RawMarker | null>(null);
  // Read through a ref so re-created handlers never capture a stale callback.
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  // Latest coordinates, readable from the async map build without going stale.
  const positionRef = useRef<LatLngLiteral>({ lat: latitude, lng: longitude });
  positionRef.current = { lat: latitude, lng: longitude };
  const selfMovedRef = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);

  // RefererNotAllowedMapError and friends surface here, not as a thrown error.
  useEffect(() => onMapsAuthFailure(() => setFailed(true)), []);

  useEffect(() => {
    let cancelled = false;

    const move = (e: { latLng?: { lat(): number; lng(): number } | null }) => {
      const position = e.latLng;
      if (!position) return;
      const next = { lat: position.lat(), lng: position.lng() };
      // The pin is already where the cashier put it; remember that so the
      // recentre effect below doesn't yank the map out from under it.
      selfMovedRef.current = key(next);
      markerRef.current?.setPosition(next);
      onMoveRef.current(next);
    };

    void (async () => {
      try {
        const sdk = await loadMapsSdk();
        if (cancelled || !containerRef.current || mapRef.current) return;

        // Read the CURRENT position, not the one captured when this effect was
        // created — the cashier may have picked another address while the SDK
        // was still loading, and the recentre effect can't fix a map that did
        // not exist yet.
        const center = positionRef.current;
        const map = new sdk.Map(containerRef.current, {
          center,
          zoom: 17,
          disableDefaultUI: true,
          zoomControl: true,
          clickableIcons: false,
          // Touch POS: one finger pans the map instead of scrolling the modal.
          gestureHandling: 'greedy',
        });
        const marker = new sdk.Marker({ map, position: center, draggable: true });

        marker.addListener('dragend', move);
        map.addListener('click', move);

        mapRef.current = map;
        markerRef.current = marker;

        // Anything that landed during construction.
        if (key(positionRef.current) !== key(center)) {
          marker.setPosition(positionRef.current);
          map.setCenter(positionRef.current);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Built once; later coordinate changes are handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A newly picked address recentres the map — but a drag must not, or the map
  // slides away under the pin the cashier just placed.
  useEffect(() => {
    const position = { lat: latitude, lng: longitude };
    if (selfMovedRef.current === key(position)) {
      selfMovedRef.current = null;
      return;
    }
    markerRef.current?.setPosition(position);
    mapRef.current?.panTo(position);
  }, [latitude, longitude]);

  // Say what happened rather than leaving a blank grey box: the address's own
  // coordinates are already captured, and the console names the exact
  // restriction to fix.
  if (failed) {
    return (
      <div className={`${className} flex items-center justify-center p-6`}>
        <p className="max-w-md text-center text-sm text-foodies-textSecondary dark:text-slate-400">
          Map unavailable — the coordinates from the selected address are still sent to the rider.
          <span className="mt-1 block text-xs">
            Admin: check the Google key&apos;s website restrictions; the browser console names the
            URL to allow.
          </span>
        </p>
      </div>
    );
  }

  return <div ref={containerRef} role="application" aria-label="Delivery location map" className={className} />;
};

export default DeliveryPinMap;

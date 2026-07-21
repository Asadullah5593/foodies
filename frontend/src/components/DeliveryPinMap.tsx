import React, { useEffect, useRef, useState } from 'react';
import { LatLngLiteral, RawMap, RawMarker, loadMapsSdk } from '../utils/googlePlaces';

interface DeliveryPinMapProps {
  latitude: number;
  longitude: number;
  /** Fired when the cashier drags the pin or taps a new spot. */
  onMove: (position: LatLngLiteral) => void;
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
const DeliveryPinMap: React.FC<DeliveryPinMapProps> = ({ latitude, longitude, onMove }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<RawMap | null>(null);
  const markerRef = useRef<RawMarker | null>(null);
  // Read through a ref so re-created handlers never capture a stale callback.
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const move = (e: { latLng?: { lat(): number; lng(): number } | null }) => {
      const position = e.latLng;
      if (!position) return;
      const next = { lat: position.lat(), lng: position.lng() };
      markerRef.current?.setPosition(next);
      onMoveRef.current(next);
    };

    void (async () => {
      try {
        const sdk = await loadMapsSdk();
        if (cancelled || !containerRef.current || mapRef.current) return;

        const center = { lat: latitude, lng: longitude };
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

  // A newly picked address (or a drag) recentres the existing map.
  useEffect(() => {
    const position = { lat: latitude, lng: longitude };
    markerRef.current?.setPosition(position);
    mapRef.current?.panTo(position);
  }, [latitude, longitude]);

  if (failed) return null;

  return (
    <div className="mt-2">
      <div
        ref={containerRef}
        role="application"
        aria-label="Delivery location map"
        className="h-44 w-full rounded-xl border border-foodies-border overflow-hidden bg-foodies-surfaceMuted"
      />
      <p className="mt-1 text-xs text-foodies-textSecondary">
        Drag the pin (or tap the map) if the rider should stop somewhere else.
      </p>
    </div>
  );
};

export default DeliveryPinMap;

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

type LatLng = { lat: number; lng: number };

const built: Array<{ mapCenter: LatLng; markerPosition: LatLng }> = [];
const setPositions: LatLng[] = [];
const setCenters: LatLng[] = [];
const panTos: LatLng[] = [];
const handlers: Record<string, (e: { latLng: { lat(): number; lng(): number } }) => void> = {};

let releaseSdk: (() => void) | null = null;

vi.mock('../utils/googlePlaces', () => ({
  onMapsAuthFailure: () => () => {},
  loadMapsSdk: () =>
    new Promise((resolve) => {
      const sdk = {
        places: {},
        Map: class {
          constructor(_el: HTMLElement, opts: { center: LatLng }) {
            built.push({ mapCenter: opts.center, markerPosition: { lat: NaN, lng: NaN } });
          }
          panTo(p: LatLng) {
            panTos.push(p);
          }
          setCenter(p: LatLng) {
            setCenters.push(p);
          }
          addListener(event: string, h: (e: { latLng: { lat(): number; lng(): number } }) => void) {
            handlers[`map:${event}`] = h;
          }
        },
        Marker: class {
          constructor(opts: { position: LatLng }) {
            built[built.length - 1].markerPosition = opts.position;
          }
          setPosition(p: LatLng) {
            setPositions.push(p);
          }
          addListener(event: string, h: (e: { latLng: { lat(): number; lng(): number } }) => void) {
            handlers[`marker:${event}`] = h;
          }
        },
      };
      releaseSdk = () => resolve(sdk);
    }),
}));

import DeliveryPinMap from './DeliveryPinMap';

const GULBERG = { lat: 31.5204, lng: 74.3587 };
const DHA = { lat: 31.475, lng: 74.41 };

describe('DeliveryPinMap', () => {
  beforeEach(() => {
    built.length = 0;
    setPositions.length = 0;
    setCenters.length = 0;
    panTos.length = 0;
    Object.keys(handlers).forEach((k) => delete handlers[k]);
    releaseSdk = null;
  });

  it('pins the address showing when the SDK arrives, not the one it started with', async () => {
    const { rerender } = render(
      <DeliveryPinMap latitude={GULBERG.lat} longitude={GULBERG.lng} onMove={() => {}} />,
    );

    // Cashier corrects themselves and picks a second address while Google's
    // script is still downloading.
    rerender(<DeliveryPinMap latitude={DHA.lat} longitude={DHA.lng} onMove={() => {}} />);
    releaseSdk?.();

    await waitFor(() => expect(built).toHaveLength(1));
    // The pin must show DHA — the address actually selected — not Gulberg.
    expect(built[0].markerPosition).toEqual(DHA);
    expect(built[0].mapCenter).toEqual(DHA);
  });

  it('leaves the map alone when the move came from the cashier dragging the pin', async () => {
    const onMove = vi.fn();
    const { rerender } = render(
      <DeliveryPinMap latitude={GULBERG.lat} longitude={GULBERG.lng} onMove={onMove} />,
    );
    releaseSdk?.();
    await waitFor(() => expect(handlers['marker:dragend']).toBeTruthy());

    const dragged = { lat: 31.5211, lng: 74.3599 };
    handlers['marker:dragend']({ latLng: { lat: () => dragged.lat, lng: () => dragged.lng } });
    expect(onMove).toHaveBeenCalledWith(dragged);

    // Parent re-renders with the dragged coordinates.
    rerender(<DeliveryPinMap latitude={dragged.lat} longitude={dragged.lng} onMove={onMove} />);

    // No pan: the pin is already there and re-centring would shove the map.
    expect(panTos).toHaveLength(0);
  });

  it('recentres when a genuinely new address is picked', async () => {
    const { rerender } = render(
      <DeliveryPinMap latitude={GULBERG.lat} longitude={GULBERG.lng} onMove={() => {}} />,
    );
    releaseSdk?.();
    await waitFor(() => expect(built).toHaveLength(1));

    rerender(<DeliveryPinMap latitude={DHA.lat} longitude={DHA.lng} onMove={() => {}} />);

    expect(panTos).toContainEqual(DHA);
    expect(setPositions).toContainEqual(DHA);
  });
});

import React, { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ResolvedPlace } from '../utils/googlePlaces';

const suggest = vi.fn();
const mapHandlers: Record<string, (e: { latLng: { lat(): number; lng(): number } }) => void> = {};
const markerPositions: Array<{ lat: number; lng: number }> = [];

// Stand in for the Google SDK: the real module reads an env key at import time
// and talks to maps.googleapis.com, neither of which exists under test.
vi.mock('../utils/googlePlaces', () => ({
  placesConfigured: true,
  createPlacesSession: () => ({ suggest }),
  onMapsAuthFailure: () => () => {},
  loadMapsSdk: async () => ({
    places: {},
    Map: class {
      constructor(_el: HTMLElement, _opts: unknown) {}
      panTo() {}
      setCenter() {}
      addListener(event: string, handler: (e: { latLng: { lat(): number; lng(): number } }) => void) {
        mapHandlers[`map:${event}`] = handler;
      }
    },
    Marker: class {
      constructor(_opts: unknown) {}
      setPosition(p: { lat: number; lng: number }) {
        markerPositions.push(p);
      }
      addListener(event: string, handler: (e: { latLng: { lat(): number; lng(): number } }) => void) {
        mapHandlers[`marker:${event}`] = handler;
      }
    },
  }),
}));

import AddressAutocomplete from './AddressAutocomplete';

const LAHORE: ResolvedPlace = {
  placeId: 'place-1',
  address: '12 Main Boulevard, Gulberg, Lahore, Pakistan',
  latitude: 31.5204,
  longitude: 74.3587,
};

/** Mirrors how OrderTaking owns the address text and the picked place. */
const Harness: React.FC<{ onPick?: (p: ResolvedPlace) => void; onUnavailable?: () => void }> = ({
  onPick,
  onUnavailable,
}) => {
  const [address, setAddress] = useState('');
  const [place, setPlace] = useState<ResolvedPlace | null>(null);
  return (
    <AddressAutocomplete
      value={address}
      onChange={setAddress}
      onPick={(p) => {
        setPlace(p);
        onPick?.(p);
      }}
      picked={place}
      onUnavailable={onUnavailable}
    />
  );
};

const renderWithQuery = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

const type = (text: string) =>
  fireEvent.change(screen.getByRole('combobox'), { target: { value: text } });

describe('AddressAutocomplete', () => {
  beforeEach(() => {
    suggest.mockReset();
    markerPositions.length = 0;
    Object.keys(mapHandlers).forEach((k) => delete mapHandlers[k]);
  });

  it('picks a suggestion, writes back the formatted address and reports coordinates', async () => {
    const resolve = vi.fn().mockResolvedValue(LAHORE);
    suggest.mockResolvedValue([
      { placeId: 'place-1', description: LAHORE.address, primary: '12 Main Boulevard', secondary: 'Gulberg, Lahore', resolve },
    ]);
    const onPick = vi.fn();
    renderWithQuery(<Harness onPick={onPick} />);

    type('12 Main');

    const option = await screen.findByText('12 Main Boulevard');
    expect(suggest).toHaveBeenCalledWith('12 Main');

    fireEvent.mouseDown(option);

    // Committed on pick, before the map is touched: dismissing the map must
    // never leave a delivery order without coordinates.
    await waitFor(() => expect(onPick).toHaveBeenCalledWith(LAHORE));
    expect(screen.getByRole('combobox')).toHaveValue(LAHORE.address);
    expect(screen.getByText(/Location pinned \(31\.520400, 74\.358700\)/)).toBeTruthy();
    // …and the full-screen map opens by itself.
    expect(await screen.findByRole('dialog', { name: 'Set delivery location' })).toBeTruthy();
  });

  it('sends the dragged coordinates, keeping the picked address text', async () => {
    suggest.mockResolvedValue([
      {
        placeId: 'place-1',
        description: LAHORE.address,
        primary: '12 Main Boulevard',
        secondary: 'Gulberg, Lahore',
        resolve: vi.fn().mockResolvedValue(LAHORE),
      },
    ]);
    const onPick = vi.fn();
    renderWithQuery(<Harness onPick={onPick} />);

    type('12 Main');
    fireEvent.mouseDown(await screen.findByText('12 Main Boulevard'));
    await screen.findByLabelText('Delivery location map');

    // The rider should stop at the gate, ~80m from Google's street-centre pin.
    await waitFor(() => expect(mapHandlers['marker:dragend']).toBeTruthy());
    mapHandlers['marker:dragend']({ latLng: { lat: () => 31.5211, lng: () => 74.3599 } });

    // Dragging is a draft — nothing reaches the order until it is confirmed.
    await waitFor(() => expect(screen.getByText('Pin: 31.521100, 74.359900')).toBeTruthy());
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenLastCalledWith(LAHORE);

    fireEvent.click(screen.getByRole('button', { name: 'Use this location' }));

    await waitFor(() =>
      expect(onPick).toHaveBeenLastCalledWith({
        ...LAHORE,
        latitude: 31.5211,
        longitude: 74.3599,
      }),
    );
    expect(screen.getByText(/Location pinned \(31\.521100, 74\.359900\)/)).toBeTruthy();
    // Dragging must not rewrite the address the cashier picked.
    expect(screen.getByRole('combobox')).toHaveValue(LAHORE.address);
    // Confirming closes the map rather than leaving it over the checkout.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the committed coordinates when the map is dismissed', async () => {
    suggest.mockResolvedValue([
      {
        placeId: 'place-1',
        description: LAHORE.address,
        primary: '12 Main Boulevard',
        secondary: 'Gulberg, Lahore',
        resolve: vi.fn().mockResolvedValue(LAHORE),
      },
    ]);
    const onPick = vi.fn();
    renderWithQuery(<Harness onPick={onPick} />);

    type('12 Main');
    fireEvent.mouseDown(await screen.findByText('12 Main Boulevard'));
    await waitFor(() => expect(mapHandlers['marker:dragend']).toBeTruthy());
    mapHandlers['marker:dragend']({ latLng: { lat: () => 31.5211, lng: () => 74.3599 } });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    // The address stays picked with Google's coordinates — the cashier is never
    // blocked from checking out by having dismissed the map.
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenLastCalledWith(LAHORE);
    expect(screen.getByText(/Location pinned \(31\.520400, 74\.358700\)/)).toBeTruthy();
    expect(screen.getByRole('combobox')).toHaveValue(LAHORE.address);
    expect(screen.queryByRole('dialog')).toBeNull();

    // Reopening starts from what is committed, not the discarded drag.
    fireEvent.click(screen.getByRole('button', { name: 'Adjust pin' }));
    await screen.findByRole('dialog', { name: 'Set delivery location' });
    expect(screen.getByText('Pin: 31.520400, 74.358700')).toBeTruthy();
  });

  it('swallows the POS window hotkeys while the map is open', async () => {
    suggest.mockResolvedValue([
      {
        placeId: 'place-1',
        description: LAHORE.address,
        primary: '12 Main Boulevard',
        secondary: 'Gulberg, Lahore',
        resolve: vi.fn().mockResolvedValue(LAHORE),
      },
    ]);
    const onPick = vi.fn();
    // Same shape as OrderTaking's handler: bubble phase, on window. It closes
    // checkout on Escape and submits the order on Ctrl+Enter, so it must not
    // see a single keystroke aimed at the map.
    const posHotkeys = vi.fn();
    window.addEventListener('keydown', posHotkeys);

    try {
      renderWithQuery(<Harness onPick={onPick} />);
      type('12 Main');
      fireEvent.mouseDown(await screen.findByText('12 Main Boulevard'));
      const dialog = await screen.findByRole('dialog', { name: 'Set delivery location' });

      fireEvent.keyDown(dialog, { key: 'Enter', ctrlKey: true });
      fireEvent.keyDown(dialog, { key: '/' });
      fireEvent.keyDown(dialog, { key: 'Escape' });

      expect(posHotkeys).not.toHaveBeenCalled();
      // Escape dismisses the map only — the pick survives.
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(onPick).toHaveBeenCalledTimes(1);
      expect(onPick).toHaveBeenLastCalledWith(LAHORE);
    } finally {
      window.removeEventListener('keydown', posHotkeys);
    }
  });

  it('opens the map when a suggestion is chosen with the keyboard', async () => {
    suggest.mockResolvedValue([
      {
        placeId: 'place-1',
        description: LAHORE.address,
        primary: '12 Main Boulevard',
        secondary: 'Gulberg, Lahore',
        resolve: vi.fn().mockResolvedValue(LAHORE),
      },
    ]);
    renderWithQuery(<Harness />);

    type('12 Main');
    await screen.findByText('12 Main Boulevard');
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });

    expect(await screen.findByRole('dialog', { name: 'Set delivery location' })).toBeTruthy();
  });

  it('does not open the map when the details lookup fails', async () => {
    suggest.mockResolvedValue([
      {
        placeId: 'place-1',
        description: LAHORE.address,
        primary: '12 Main Boulevard',
        secondary: 'Gulberg, Lahore',
        resolve: vi.fn().mockRejectedValue(new Error('no coordinates')),
      },
    ]);
    const onPick = vi.fn();
    renderWithQuery(<Harness onPick={onPick} />);

    type('12 Main');
    fireEvent.mouseDown(await screen.findByText('12 Main Boulevard'));

    // Text still lands so the cashier can see what they chose, but with no
    // coordinates there is nothing to pin and no map to open.
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue(LAHORE.address));
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('moves the pin when the cashier taps the map', async () => {
    suggest.mockResolvedValue([
      {
        placeId: 'place-1',
        description: LAHORE.address,
        primary: '12 Main Boulevard',
        secondary: 'Gulberg, Lahore',
        resolve: vi.fn().mockResolvedValue(LAHORE),
      },
    ]);
    renderWithQuery(<Harness />);

    type('12 Main');
    fireEvent.mouseDown(await screen.findByText('12 Main Boulevard'));
    await waitFor(() => expect(mapHandlers['map:click']).toBeTruthy());

    mapHandlers['map:click']({ latLng: { lat: () => 31.52, lng: () => 74.36 } });

    await waitFor(() => expect(screen.getByText(/31\.520000, 74\.360000/)).toBeTruthy());
    expect(markerPositions).toContainEqual({ lat: 31.52, lng: 74.36 });
  });

  it('ignores a details lookup that lands after a newer address was picked', async () => {
    const DHA = {
      placeId: 'place-2',
      address: '45 Park Lane, DHA Phase 5, Lahore, Pakistan',
      latitude: 31.475,
      longitude: 74.41,
    };
    // The first lookup hangs; the cashier changes their mind and picks the
    // second, which resolves straight away. The stale one lands afterwards.
    let releaseFirst: (() => void) | null = null;
    const slow = new Promise<typeof LAHORE>((resolve) => {
      releaseFirst = () => resolve(LAHORE);
    });
    suggest.mockResolvedValue([
      {
        placeId: 'place-1',
        description: LAHORE.address,
        primary: '12 Main Boulevard',
        secondary: 'Gulberg, Lahore',
        resolve: () => slow,
      },
      {
        placeId: 'place-2',
        description: DHA.address,
        primary: '45 Park Lane',
        secondary: 'DHA Phase 5, Lahore',
        resolve: vi.fn().mockResolvedValue(DHA),
      },
    ]);
    const onPick = vi.fn();
    renderWithQuery(<Harness onPick={onPick} />);

    type('12 Main');
    fireEvent.mouseDown(await screen.findByText('12 Main Boulevard'));
    type('45 Park');
    fireEvent.mouseDown(await screen.findByText('45 Park Lane'));
    await waitFor(() => expect(onPick).toHaveBeenCalledWith(DHA));

    releaseFirst!();
    await new Promise((r) => setTimeout(r, 50));

    // The abandoned lookup must not resurrect its address, its coordinates, or
    // its map — the rider would be sent to a place nobody selected.
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenLastCalledWith(DHA);
    expect(screen.getByRole('combobox')).toHaveValue(DHA.address);
    expect(screen.getByText(/Location pinned \(31\.475000, 74\.410000\)/)).toBeTruthy();
  });

  it('does not query Google until the third character', async () => {
    suggest.mockResolvedValue([]);
    renderWithQuery(<Harness />);

    type('12');
    await new Promise((r) => setTimeout(r, 400));
    expect(suggest).not.toHaveBeenCalled();

    type('123');
    await waitFor(() => expect(suggest).toHaveBeenCalledWith('123'));
  });

  it('keeps the pin but flags that the address was edited afterwards', async () => {
    suggest.mockResolvedValue([
      {
        placeId: 'place-1',
        description: LAHORE.address,
        primary: '12 Main Boulevard',
        secondary: 'Gulberg, Lahore',
        resolve: vi.fn().mockResolvedValue(LAHORE),
      },
    ]);
    renderWithQuery(<Harness />);

    type('12 Main');
    fireEvent.mouseDown(await screen.findByText('12 Main Boulevard'));
    await screen.findByText(/Location pinned/);
    // Close the map first — the address box is behind it.
    fireEvent.click(await screen.findByRole('button', { name: 'Use this location' }));

    type(`${LAHORE.address}, Flat 3B`);

    expect(screen.getByText(/address edited after selection/)).toBeTruthy();
    expect(screen.getByText(/Location pinned/)).toBeTruthy();
  });

  it('degrades to a plain address box when the SDK fails, and says so', async () => {
    suggest.mockRejectedValue(new Error('Failed to load the Google Maps SDK'));
    const onUnavailable = vi.fn();
    renderWithQuery(<Harness onUnavailable={onUnavailable} />);

    type('12 Main Boulevard');

    await waitFor(() => expect(onUnavailable).toHaveBeenCalled());
    expect(screen.getByText(/Address search unavailable/)).toBeTruthy();
    // Whatever was typed survives, so the cashier can still place the order.
    expect(screen.getByRole('combobox')).toHaveValue('12 Main Boulevard');
  });
});

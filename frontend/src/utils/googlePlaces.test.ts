import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Req = { input: string; sessionToken?: object; includedRegionCodes?: string[] };

/** Installs a fake Maps SDK on window and returns the requests it received. */
function installFakeSdk() {
  const requests: Req[] = [];
  const fetchFields = vi.fn(async (r: { fields: string[] }) => {
    requests.push({ input: `details:${r.fields.join(',')}` });
    return {
      place: {
        formattedAddress: '12 Main Boulevard, Gulberg III, Lahore, Pakistan',
        location: { lat: () => 31.5204, lng: () => 74.3587 },
      },
    };
  });

  (window as unknown as { google: unknown }).google = {
    maps: {
      places: {
        AutocompleteSessionToken: class {},
        AutocompleteSuggestion: {
          fetchAutocompleteSuggestions: vi.fn(async (req: Req) => {
            requests.push(req);
            return {
              suggestions: [
                {
                  placePrediction: {
                    placeId: 'p1',
                    text: { text: '12 Main Boulevard, Gulberg III, Lahore, Pakistan' },
                    mainText: { text: '12 Main Boulevard' },
                    secondaryText: { text: 'Gulberg III, Lahore, Pakistan' },
                    toPlace: () => ({ fetchFields }),
                  },
                },
                { placePrediction: null }, // Google can return non-place suggestions
              ],
            };
          }),
        },
      },
    },
  };
  return requests;
}

describe('googlePlaces session', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete (window as unknown as { google?: unknown }).google;
  });

  it('restricts to the configured country and bills one session per lookup', async () => {
    vi.stubEnv('VITE_GOOGLE_PLACES_COUNTRY', 'pk');
    const requests = installFakeSdk();
    const { createPlacesSession } = await import('./googlePlaces');
    const session = createPlacesSession();

    await session.suggest('12 M');
    const [suggestion] = await session.suggest('12 Main');

    const [first, second] = requests as Req[];
    expect(first.includedRegionCodes).toEqual(['pk']);
    // Keystrokes share one token, so Google charges a single session.
    expect(first.sessionToken).toBe(second.sessionToken);
    expect(suggestion.primary).toBe('12 Main Boulevard');

    const place = await suggestion.resolve();
    expect(place).toEqual({
      placeId: 'p1',
      address: '12 Main Boulevard, Gulberg III, Lahore, Pakistan',
      latitude: 31.5204,
      longitude: 74.3587,
    });
    // Cheapest details tier: coordinates plus the address we store on the order.
    expect(requests[2].input).toBe('details:formattedAddress,location');

    // The details call closed that session; the next lookup starts a new one.
    await session.suggest('7 Jail');
    expect((requests[3] as Req).sessionToken).not.toBe(first.sessionToken);
  });

  it('sends no region filter when the country is blank', async () => {
    vi.stubEnv('VITE_GOOGLE_PLACES_COUNTRY', '');
    const requests = installFakeSdk();
    const { createPlacesSession } = await import('./googlePlaces');

    await createPlacesSession().suggest('12 Main');

    expect(requests[0].includedRegionCodes).toBeUndefined();
  });

  it('reports itself unconfigured when no key is set', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '');
    const { placesConfigured, loadPlacesLibrary } = await import('./googlePlaces');

    expect(placesConfigured).toBe(false);
    await expect(loadPlacesLibrary()).rejects.toThrow(/VITE_GOOGLE_MAPS_API_KEY/);
  });
});

// Google Places lookups for the POS, via the Maps JavaScript API.
//
// Google's `maps/api/place/*/json` web services send no CORS headers, so a
// browser cannot fetch them directly — we load the Maps JS SDK instead and use
// the current (non-deprecated) Places classes: AutocompleteSuggestion for the
// typeahead, Place.fetchFields for the coordinates.
//
// Billing: one AutocompleteSessionToken spans every keystroke of a lookup plus
// the details call, so Google bills the whole thing as a single session. The
// token is consumed by fetchFields and a fresh one starts the next lookup.
// fetchFields asks for `location` only — the cheapest details SKU.

const API_KEY = ((import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ?? '').trim();
// Region filter — the Places API (New) spelling of `components=country:pk`.
// Blank means no restriction; set it per deployment rather than in code.
const COUNTRY = ((import.meta.env.VITE_GOOGLE_PLACES_COUNTRY as string | undefined) ?? 'pk')
  .trim()
  .toLowerCase();
const SCRIPT_ID = 'foodies-google-maps-sdk';
const CALLBACK = '__foodiesGoogleMapsReady';

/** False when no key is configured — callers fall back to a plain address box. */
export const placesConfigured = API_KEY.length > 0;

export interface ResolvedPlace {
  placeId: string;
  address: string;
  latitude: number;
  longitude: number;
}

export interface AddressSuggestion {
  placeId: string;
  /** Full readable address — what the dropdown row shows. */
  description: string;
  primary: string;
  secondary: string;
  /** Closes the session and fetches this place's coordinates. */
  resolve: () => Promise<ResolvedPlace>;
}

// Structural types for the slice of the SDK we touch, so we don't need
// @types/google.maps (and the lockfile churn that comes with it).
interface RawLatLng {
  lat(): number;
  lng(): number;
}

interface RawPlace {
  formattedAddress?: string | null;
  location?: RawLatLng | null;
  fetchFields(request: { fields: string[] }): Promise<{ place?: RawPlace }>;
}

interface RawPrediction {
  placeId: string;
  text?: { text?: string } | null;
  mainText?: { text?: string } | null;
  secondaryText?: { text?: string } | null;
  toPlace(): RawPlace;
}

interface PlacesLib {
  AutocompleteSessionToken: new () => object;
  AutocompleteSuggestion: {
    fetchAutocompleteSuggestions(request: {
      input: string;
      sessionToken?: object;
      includedRegionCodes?: string[];
    }): Promise<{ suggestions: Array<{ placePrediction?: RawPrediction | null }> }>;
  };
}

type MapsWindow = Window &
  Record<string, unknown> & {
    google?: { maps?: { places?: PlacesLib } };
  };

let libPromise: Promise<PlacesLib> | null = null;

/** Loads the Maps JS SDK once. Rejects (and allows a retry) if it never arrives. */
export function loadPlacesLibrary(): Promise<PlacesLib> {
  if (libPromise) return libPromise;
  if (!placesConfigured) {
    return Promise.reject(new Error('VITE_GOOGLE_MAPS_API_KEY is not set'));
  }

  const w = window as unknown as MapsWindow;
  const pending = new Promise<PlacesLib>((resolve, reject) => {
    const ready = w.google?.maps?.places;
    if (ready) {
      resolve(ready);
      return;
    }

    w[CALLBACK] = () => {
      const places = w.google?.maps?.places;
      if (places) resolve(places);
      else reject(new Error('Google Maps loaded without the Places library'));
    };

    // A script tag already in flight will fire the shared callback for us.
    if (document.getElementById(SCRIPT_ID)) return;

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.async = true;
    script.src =
      'https://maps.googleapis.com/maps/api/js' +
      `?key=${encodeURIComponent(API_KEY)}` +
      `&libraries=places&loading=async&v=weekly&callback=${CALLBACK}`;
    script.onerror = () => {
      script.remove();
      reject(new Error('Failed to load the Google Maps SDK'));
    };
    document.head.appendChild(script);
  });

  // Drop the memo on failure so a later attempt can retry the load.
  libPromise = pending.catch((err) => {
    libPromise = null;
    throw err;
  });
  return libPromise;
}

export interface PlacesSession {
  suggest(input: string): Promise<AddressSuggestion[]>;
}

/**
 * One lookup session: keystrokes share a token, and the details call that
 * follows a pick closes it. Hold a single session per address field.
 */
export function createPlacesSession(): PlacesSession {
  let token: object | undefined;

  return {
    async suggest(input: string): Promise<AddressSuggestion[]> {
      const lib = await loadPlacesLibrary();
      if (!token) token = new lib.AutocompleteSessionToken();

      const { suggestions } = await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input,
        sessionToken: token,
        ...(COUNTRY ? { includedRegionCodes: [COUNTRY] } : {}),
      });

      return suggestions.flatMap((s) => {
        const prediction = s.placePrediction;
        if (!prediction) return [];
        const description = prediction.text?.text ?? '';
        return [
          {
            placeId: prediction.placeId,
            description,
            primary: prediction.mainText?.text ?? description,
            secondary: prediction.secondaryText?.text ?? '',
            resolve: async (): Promise<ResolvedPlace> => {
              const place = prediction.toPlace();
              const result = await place.fetchFields({ fields: ['formattedAddress', 'location'] });
              token = undefined; // the details call ends the billing session
              const resolved = result?.place ?? place;
              const location = resolved.location;
              if (!location) throw new Error('Google returned no coordinates for this place');
              return {
                placeId: prediction.placeId,
                address: resolved.formattedAddress || description,
                latitude: location.lat(),
                longitude: location.lng(),
              };
            },
          },
        ];
      });
    },
  };
}

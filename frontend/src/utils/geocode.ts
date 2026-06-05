// Thin wrappers over the free OpenStreetMap Nominatim geocoding service.
// No API key required. Respect the usage policy: keep requests light (callers
// debounce) and fail soft — the map must keep working even if Nominatim is down.

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';

export interface PlaceResult {
  label: string;
  lat: number;
  lon: number;
}

interface NominatimSearchItem {
  display_name: string;
  lat: string;
  lon: string;
}

interface NominatimReverseResult {
  display_name?: string;
}

/** Forward-geocode a free-text query (place name / address) to candidate points. */
export async function searchPlaces(query: string): Promise<PlaceResult[]> {
  const q = query.trim();
  if (!q) return [];
  try {
    const url = `${NOMINATIM_BASE}/search?format=json&addressdetails=1&limit=5&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return [];
    const data = (await res.json()) as NominatimSearchItem[];
    return data
      .map((item) => ({
        label: item.display_name,
        lat: parseFloat(item.lat),
        lon: parseFloat(item.lon),
      }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  } catch {
    return [];
  }
}

/** Reverse-geocode a coordinate to a human-readable address. Returns '' on failure. */
export async function reverseGeocode(lat: number, lon: number): Promise<string> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';
  try {
    const url = `${NOMINATIM_BASE}/reverse?format=json&lat=${lat}&lon=${lon}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return '';
    const data = (await res.json()) as NominatimReverseResult;
    return data.display_name ?? '';
  } catch {
    return '';
  }
}

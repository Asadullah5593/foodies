# POS delivery address → Google Places

The POS attaches drop-off coordinates to delivery orders so the Rider app
navigates to a pin instead of text-searching the address. The cashier types an
address, picks a Google suggestion, and the order carries
`delivery_latitude` / `delivery_longitude`.

## Google Cloud setup

Enable on the project that owns the key:

| API | Host | Why |
|---|---|---|
| **Maps JavaScript API** | `maps.googleapis.com/maps/api/js` | The POS is a browser app; the JSON web services (`/place/autocomplete/json`, `/place/details/json`) send no CORS headers and cannot be called from a page. |
| **Places API (New)** | `places.googleapis.com` | Backs `AutocompleteSuggestion` and `Place.fetchFields`, the classes the POS uses. |
| **Places API** (legacy) | — | Only needed for the deprecated `AutocompleteService` / `PlacesService` classes. Enable it if you also want that fallback; projects created after 1 Mar 2025 cannot. |

Not required: Geocoding, Maps Static, Directions/Routes.

Key restrictions (Credentials → API key):

- **Application restrictions:** HTTP referrers — the POS origins only
  (`https://pos.foodies-pakistan.com/*`, plus `http://localhost:3000/*` for dev).
  A browser key is public by design; referrer rules are what protect it.
- **API restrictions:** the two APIs above and nothing else.
- Use a **separate key from the mobile app's** — different restriction type, and
  it can be rotated without shipping an app build.

## Wiring

`frontend/.env` (and the deploy environment):

```
VITE_GOOGLE_MAPS_API_KEY=AIza...
VITE_GOOGLE_PLACES_COUNTRY=pk   # blank = worldwide suggestions
```

Vite inlines both at build time, so changing either needs a rebuild.

The key must be **referrer-restricted to every origin that serves the POS** —
including `http://localhost:3000/*` for development. A referrer that is not on
the allowlist gets `API_KEY_HTTP_REFERRER_BLOCKED` and the field silently
degrades to a plain address box.

## Behaviour

- `frontend/src/utils/googlePlaces.ts` loads the SDK once and exposes a session:
  `createPlacesSession().suggest(input)` → suggestions, each with `resolve()`
  that fetches coordinates.
- One `AutocompleteSessionToken` covers every keystroke of a lookup plus the
  details call, so Google bills it as a single session. `fetchFields` requests
  `formattedAddress` + `location` only — the cheapest details SKU.
- Search starts at 3 characters, debounced 300 ms, and results are cached for
  5 minutes by React Query.
- Suggestions are filtered to `VITE_GOOGLE_PLACES_COUNTRY` (`pk` by default) —
  the Places API (New) spelling of the legacy `components=country:pk`.
- **Delivery orders require a picked suggestion.** Typing an address without
  selecting one is rejected at checkout.
- If the key is missing or the SDK fails to load, the field degrades to a plain
  address box, the requirement is dropped, and the order goes out without
  coordinates (the Rider app's existing text-search fallback applies). This
  keeps the counter working when Google is unreachable.
- Editing the text after picking keeps the pin (cashiers append house/flat
  numbers) and shows a note that the address was edited.

## Where the coordinates go

`POST /api/pos/orders` body → `latitude` / `longitude` →
`orders.delivery_latitude` / `delivery_longitude` → the rider payload in
`backend/src/orders/rider-orders.controller.ts`.

The consumer/mobile order endpoint already accepted the same two fields; this
only closed the POS gap.

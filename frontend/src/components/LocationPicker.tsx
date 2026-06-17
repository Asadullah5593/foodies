import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { toast } from 'react-hot-toast';
import { MdOutlineLocationOn } from 'react-icons/md';
import 'leaflet/dist/leaflet.css';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { reverseGeocode, searchPlaces, PlaceResult } from '../utils/geocode';

// Fix default marker icons under Vite (same approach as consumer-web/branch-map.tsx).
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const DEFAULT_CENTER: [number, number] = [24.8607, 67.0011]; // Karachi
const fmt = (n: number) => n.toFixed(7);

interface LocationPickerProps {
  latitude: string;
  longitude: string;
  onChange: (lat: string, lng: string) => void;
  onAddressResolve?: (address: string) => void;
}

function parseCoord(value: string): number | null {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Re-centers the map when lat/lng props change from outside (e.g. manual input).
function Recenter({ position }: { position: [number, number] | null }) {
  const map = useMap();
  const lastRef = useRef<string>('');
  useEffect(() => {
    if (!position) return;
    const key = `${position[0]},${position[1]}`;
    if (key === lastRef.current) return;
    lastRef.current = key;
    map.flyTo(position, Math.max(map.getZoom(), 15), { duration: 0.4 });
  }, [position, map]);
  return null;
}

// Captures clicks on the map to drop/move the pin.
function ClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click: (e) => onPick(e.latlng.lat, e.latlng.lng),
  });
  return null;
}

const LocationPicker: React.FC<LocationPickerProps> = ({
  latitude,
  longitude,
  onChange,
  onAddressResolve,
}) => {
  const lat = parseCoord(latitude);
  const lng = parseCoord(longitude);
  const position: [number, number] | null = lat != null && lng != null ? [lat, lng] : null;

  const [searchInput, setSearchInput] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [searching, setSearching] = useState(false);
  const debouncedSearch = useDebouncedValue(searchInput.trim(), 500);

  // Apply a picked point: update coordinates + reverse-geocode the address.
  const applyPoint = (newLat: number, newLng: number) => {
    onChange(fmt(newLat), fmt(newLng));
    if (onAddressResolve) {
      reverseGeocode(newLat, newLng).then((addr) => {
        if (addr) onAddressResolve(addr);
      });
    }
  };

  useEffect(() => {
    let active = true;
    if (!debouncedSearch) {
      setResults([]);
      return;
    }
    setSearching(true);
    searchPlaces(debouncedSearch).then((places) => {
      if (!active) return;
      setResults(places);
      setShowResults(true);
      setSearching(false);
    });
    return () => {
      active = false;
    };
  }, [debouncedSearch]);

  const handleSelectResult = (place: PlaceResult) => {
    setShowResults(false);
    setSearchInput(place.label);
    onChange(fmt(place.lat), fmt(place.lon));
    if (onAddressResolve) onAddressResolve(place.label);
  };

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by this browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => applyPoint(pos.coords.latitude, pos.coords.longitude),
      () => toast.error('Could not get your location. Please allow location access or pick on the map.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const inputClass =
    'w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-red-500/50 dark:focus:ring-red-500/40 focus:border-red-500 dark:focus:border-red-500 transition-colors';

  return (
    <div className="space-y-2">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onFocus={() => results.length > 0 && setShowResults(true)}
            onBlur={() => window.setTimeout(() => setShowResults(false), 150)}
            className={inputClass}
            placeholder="Search a place or address…"
          />
          {showResults && (results.length > 0 || searching) && (
            <ul className="absolute z-[1000] mt-1 w-full max-h-60 overflow-auto rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-lg text-sm">
              {searching && results.length === 0 ? (
                <li className="px-3 py-2 text-gray-500 dark:text-slate-400">Searching…</li>
              ) : (
                results.map((place, i) => (
                  <li key={`${place.lat},${place.lon},${i}`}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleSelectResult(place)}
                      className="block w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-700 dark:text-slate-200"
                    >
                      {place.label}
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
        <button
          type="button"
          onClick={handleUseMyLocation}
          className="px-4 py-2.5 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap text-sm font-medium"
        >
          <MdOutlineLocationOn className="inline h-4 w-4 mr-1 align-text-bottom" /> Use my location
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-300 dark:border-slate-600">
        <MapContainer
          center={position ?? DEFAULT_CENTER}
          zoom={position ? 15 : 11}
          style={{ height: '320px', width: '100%' }}
          scrollWheelZoom
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ClickHandler onPick={applyPoint} />
          <Recenter position={position} />
          {position && (
            <Marker
              position={position}
              draggable
              eventHandlers={{
                dragend: (e) => {
                  const m = e.target as L.Marker;
                  const ll = m.getLatLng();
                  applyPoint(ll.lat, ll.lng);
                },
              }}
            />
          )}
        </MapContainer>
      </div>
      <p className="text-xs text-gray-500 dark:text-slate-400">
        Click the map, drag the pin, search above, or use your location to set the branch position.
      </p>
    </div>
  );
};

export default LocationPicker;

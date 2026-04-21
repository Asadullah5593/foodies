"use client";

import { useEffect } from "react";
import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import type { Branch } from "@/lib/api/types";

type Props = {
  userLocation: { latitude: number; longitude: number } | null;
  branches: Branch[];
  onSelectBranch: (branch: Branch) => void;
  height?: number | string;
};

const redIcon = new L.Icon({
  iconRetinaUrl:
    "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png",
  iconUrl:
    "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png",
  shadowUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const blueIcon = new L.Icon({
  iconRetinaUrl:
    "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png",
  iconUrl:
    "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-blue.png",
  shadowUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

function FitToMarkers({
  userLocation,
  branches,
}: {
  userLocation: { latitude: number; longitude: number } | null;
  branches: Branch[];
}) {
  const map = useMap();

  useEffect(() => {
    const points: [number, number][] = [];
    if (userLocation) {
      points.push([userLocation.latitude, userLocation.longitude]);
    }
    branches.forEach((branch) => {
      if (typeof branch.latitude === "number" && typeof branch.longitude === "number") {
        points.push([branch.latitude, branch.longitude]);
      }
    });
    if (points.length > 1) {
      map.fitBounds(points, { padding: [40, 40] });
    } else if (points.length === 1) {
      map.setView(points[0], 13);
    }
  }, [branches, map, userLocation]);

  return null;
}

function BranchMarkers({
  branches,
  onSelectBranch,
}: {
  branches: Branch[];
  onSelectBranch: (branch: Branch) => void;
}) {
  const map = useMap();

  return (
    <>
      {branches
        .filter(
          (branch) =>
            typeof branch.latitude === "number" &&
            typeof branch.longitude === "number",
        )
        .map((branch) => (
          <Marker
            key={branch.id}
            position={[branch.latitude as number, branch.longitude as number]}
            icon={redIcon}
            eventHandlers={{
              click: () => {
                onSelectBranch(branch);
                map.flyTo(
                  [branch.latitude as number, branch.longitude as number],
                  Math.min(18, map.getZoom() + 1),
                  { duration: 0.35 },
                );
              },
            }}
          >
            <Popup>
              <div className="space-y-1 text-xs">
                <p>
                  Coordinates:{" "}
                  {(branch.latitude as number).toFixed(6)}, {(branch.longitude as number).toFixed(6)}
                </p>
                {branch.address ? <p>Address: {branch.address}</p> : null}
                {branch.phone ? <p>Phone: {branch.phone}</p> : null}
                {branch.email ? <p>Email: {branch.email}</p> : null}
              </div>
            </Popup>
          </Marker>
        ))}
    </>
  );
}

export function BranchMap({ userLocation, branches, onSelectBranch, height = 640 }: Props) {
  useEffect(() => {
    delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })
      ._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl:
        "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
      iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
      shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
    });
  }, []);

  const center: [number, number] = userLocation
    ? [userLocation.latitude, userLocation.longitude]
    : [31.5204, 74.3587];

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-800">
      <MapContainer
        center={center}
        zoom={12}
        style={{
          height: typeof height === "number" ? `${height}px` : height,
          width: "100%",
        }}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitToMarkers userLocation={userLocation} branches={branches} />

        {userLocation ? (
          <Marker
            position={[userLocation.latitude, userLocation.longitude]}
            icon={blueIcon}
          >
            <Popup>
              <div className="text-xs">
                Coordinates: {userLocation.latitude.toFixed(6)},{" "}
                {userLocation.longitude.toFixed(6)}
              </div>
            </Popup>
          </Marker>
        ) : null}

        <BranchMarkers branches={branches} onSelectBranch={onSelectBranch} />
      </MapContainer>
    </div>
  );
}

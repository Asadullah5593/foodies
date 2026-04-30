"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getConsumerBranches } from "@/lib/api/consumer";
import { useSessionStore } from "@/lib/store/session-store";
import type { Branch } from "@/lib/api/types";

export const HOME_IMAGE = {
  hero: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=2400&q=80",
  branchA:
    "https://images.unsplash.com/photo-1528605248644-14dd04022da1?auto=format&fit=crop&w=1200&q=80",
  branchB:
    "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1200&q=80",
  branchC:
    "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=1200&q=80",
} as const;

export function useHomePage() {
  const router = useRouter();
  const selectedBranchId = useSessionStore((s) => s.selectedBranchId);
  const setSelectedBranch = useSessionStore((s) => s.setSelectedBranch);
  const userLocation = useSessionStore((s) => s.userLocation);
  const branchSearchLocation = useSessionStore((s) => s.branchSearchLocation);
  const setUserLocation = useSessionStore((s) => s.setUserLocation);
  const setBranchSearchLocation = useSessionStore((s) => s.setBranchSearchLocation);
  const setUserAddress = useSessionStore((s) => s.setUserAddress);
  const userAddress = useSessionStore((s) => s.userAddress);

  const queryCoords = userLocation ?? branchSearchLocation;

  const [locationStatus, setLocationStatus] = useState<"idle" | "loading" | "denied">(
    "idle",
  );
  const [viewMode, setViewMode] = useState<"list" | "map">("list");
  const [branchListFilter, setBranchListFilter] = useState("");
  const mapSectionRef = useRef<HTMLDivElement | null>(null);

  const branchesQuery = useQuery({
    queryKey: ["consumer-branches", queryCoords?.latitude ?? "all", queryCoords?.longitude ?? "all"],
    queryFn: () =>
      queryCoords
        ? getConsumerBranches({
            latitude: queryCoords.latitude,
            longitude: queryCoords.longitude,
            radiusKm: 10,
          })
        : getConsumerBranches(),
    // Smooth UI updates when switching from "all branches" to "near me".
    placeholderData: (prev) => prev,
  });

  /** Branches with at least one linked brand (browse/menu is useless otherwise). */
  const branches = useMemo(
    () =>
      (branchesQuery.data ?? []).filter((b) => (b.brand_ids?.length ?? 0) > 0),
    [branchesQuery.data],
  );

  const selectBranchAndGoToMenu = useCallback(
    (branch: Branch) => {
      setSelectedBranch(branch);
      router.push("/menu");
    },
    [setSelectedBranch, router],
  );

  const requestLocation = () => {
    setLocationStatus("loading");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const nextCoords = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        };
        setUserLocation(nextCoords);
        setBranchSearchLocation(nextCoords);
        setLocationStatus("idle");
        try {
          const reverse = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${nextCoords.latitude}&lon=${nextCoords.longitude}`,
          );
          if (reverse.ok) {
            const data = (await reverse.json()) as { display_name?: string };
            if (data.display_name) {
              setUserAddress(data.display_name);
            }
          }
        } catch {
          // Keep existing address if reverse geocoding fails.
        }
      },
      () => {
        setUserLocation(null);
        setBranchSearchLocation(null);
        setUserAddress(null);
        setLocationStatus("denied");
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  };

  const haversineKm = useCallback(
    (
      a: { latitude: number; longitude: number },
      b: { latitude: number; longitude: number },
    ) => {
      const toRad = (deg: number) => (deg * Math.PI) / 180;
      const R = 6371;
      const dLat = toRad(b.latitude - a.latitude);
      const dLon = toRad(b.longitude - a.longitude);
      const lat1 = toRad(a.latitude);
      const lat2 = toRad(b.latitude);
      const sinDLat = Math.sin(dLat / 2);
      const sinDLon = Math.sin(dLon / 2);
      const h =
        sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
      return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    },
    [],
  );

  const distanceKmForBranch = useCallback(
    (branch: Branch) => {
      if (
        userLocation &&
        typeof branch.latitude === "number" &&
        typeof branch.longitude === "number"
      ) {
        return haversineKm(userLocation, {
          latitude: branch.latitude,
          longitude: branch.longitude,
        });
      }
      if (
        queryCoords &&
        typeof branch.latitude === "number" &&
        typeof branch.longitude === "number"
      ) {
        return haversineKm(queryCoords, {
          latitude: branch.latitude,
          longitude: branch.longitude,
        });
      }
      if (typeof branch.distance_km === "number") return branch.distance_km;
      return null;
    },
    [haversineKm, queryCoords, userLocation],
  );

  const sortedBranches = useMemo(() => {
    const q = branchListFilter.trim().toLowerCase();
    const filtered = q
      ? branches.filter((b) => {
          const blob = `${b.name ?? ""} ${b.address ?? ""} ${b.code ?? ""}`.toLowerCase();
          return blob.includes(q);
        })
      : branches;

    const withDist = filtered.map((b) => ({ b, d: distanceKmForBranch(b) }));
    const anyDist = withDist.some((x) => x.d != null);
    if (anyDist) {
      return withDist
        .sort((x, y) => (x.d ?? Number.MAX_SAFE_INTEGER) - (y.d ?? Number.MAX_SAFE_INTEGER))
        .map((x) => x.b);
    }
    return [...filtered].sort((a, b) =>
      (a.name ?? "").localeCompare(b.name ?? "", undefined, { sensitivity: "base" }),
    );
  }, [branchListFilter, branches, distanceKmForBranch]);

  const branchCoverForBranch = useCallback((branch: Branch) => {
    const id = typeof branch.id === "number" ? branch.id : 0;
    const covers = [HOME_IMAGE.branchA, HOME_IMAGE.branchB, HOME_IMAGE.branchC];
    return covers[Math.abs(id) % covers.length];
  }, []);

  const distanceSubLabel = useCallback((km: number) => `${km.toFixed(1)} km away`, []);

  const getBranchTags = useCallback((branch: Branch) => {
    const tags: string[] = [];
    if (branch.supports_dine_in) tags.push("Dine in");
    if (branch.supports_pickup) tags.push("Pickup");
    if (branch.supports_delivery) tags.push("Delivery");
    if (branch.supports_takeaway) tags.push("Takeaway");
    return tags.slice(0, 3);
  }, []);

  useEffect(() => {
    if (viewMode !== "map") return;
    if (!branches.length) return;
    const el = mapSectionRef.current;
    if (!el) return;

    const scroll = () => {
      const headerOffset = 96;
      const top = el.getBoundingClientRect().top + window.scrollY - headerOffset;
      window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    };

    const t1 = window.setTimeout(scroll, 60);
    const t2 = window.setTimeout(scroll, 220);
    const t3 = window.setTimeout(scroll, 450);
    const raf1 = window.requestAnimationFrame(scroll);
    const raf2 = window.requestAnimationFrame(() => window.requestAnimationFrame(scroll));

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
    };
  }, [branches.length, viewMode]);

  return {
    router,
    queryCoords,
    locationStatus,
    requestLocation,
    viewMode,
    setViewMode,
    mapSectionRef,
    branchesQuery,
    branches,
    sortedBranches,
    branchListFilter,
    setBranchListFilter,
    selectedBranchId,
    setSelectedBranch,
    selectBranchAndGoToMenu,
    distanceKmForBranch,
    branchCoverForBranch,
    getBranchTags,
    distanceSubLabel,
    userAddress,
    userLocation,
  };
}

export type HomePageState = ReturnType<typeof useHomePage>;

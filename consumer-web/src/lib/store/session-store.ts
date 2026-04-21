"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Branch, Customer } from "@/lib/api/types";

type SessionState = {
  token: string | null;
  customer: Customer | null;
  selectedBranchId: number | null;
  selectedBranch: Branch | null;
  selectedBrandId: number | null;
  userLocation: { latitude: number; longitude: number } | null;
  branchSearchLocation: { latitude: number; longitude: number } | null;
  userAddress: string | null;
  theme: "dark" | "light";
  setSession: (token: string, customer: Customer) => void;
  clearSession: () => void;
  setBranchId: (branchId: number | null) => void;
  setSelectedBranch: (branch: Branch | null) => void;
  setBrandId: (brandId: number | null) => void;
  setUserLocation: (location: { latitude: number; longitude: number } | null) => void;
  setBranchSearchLocation: (
    location: { latitude: number; longitude: number } | null,
  ) => void;
  setUserAddress: (address: string | null) => void;
  setTheme: (theme: "dark" | "light") => void;
};

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      token: null,
      customer: null,
      selectedBranchId: null,
      selectedBranch: null,
      selectedBrandId: null,
      userLocation: null,
      branchSearchLocation: null,
      userAddress: null,
      theme: "light",
      setSession: (token, customer) => set({ token, customer }),
      clearSession: () => set({ token: null, customer: null }),
      setBranchId: (selectedBranchId) =>
        set({ selectedBranchId, selectedBrandId: null, selectedBranch: null }),
      setSelectedBranch: (selectedBranch) =>
        set({
          selectedBranchId: selectedBranch?.id ?? null,
          selectedBranch,
          selectedBrandId: null,
          // Keep user's real location intact; only update the fallback search anchor.
          branchSearchLocation:
            selectedBranch &&
            typeof selectedBranch.latitude === "number" &&
            typeof selectedBranch.longitude === "number"
              ? { latitude: selectedBranch.latitude, longitude: selectedBranch.longitude }
              : null,
        }),
      setBrandId: (selectedBrandId) => set({ selectedBrandId }),
      setUserLocation: (userLocation) => set({ userLocation }),
      setBranchSearchLocation: (branchSearchLocation) => set({ branchSearchLocation }),
      setUserAddress: (userAddress) => set({ userAddress }),
      setTheme: (theme) => set({ theme }),
    }),
    { name: "foodies-consumer-session" },
  ),
);

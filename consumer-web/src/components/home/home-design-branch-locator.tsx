"use client";

import Image from "next/image";
import Link from "next/link";
import { Button, Loader } from "@/components/ui";
import { BranchMap } from "@/components/home/branch-map-dynamic";
import { HomeContinueCard } from "@/components/home/home-continue-card";
import { useHomePage } from "@/lib/hooks/use-home-page";
import type { Branch } from "@/lib/api/types";

function kmToMi(km: number) {
  return (km * 0.621371).toFixed(1);
}

export function HomeDesignBranchLocator() {
  const h = useHomePage();
  const {
    queryCoords,
    locationStatus,
    requestLocation,
    viewMode,
    setViewMode,
    branchesQuery,
    sortedBranches,
    selectedBranchId,
    selectBranchAndGoToMenu,
    distanceKmForBranch,
    branchCoverForBranch,
    getBranchTags,
    userAddress,
  } = h;

  const locationTitle =
    userAddress?.split(",").slice(0, 2).join(",").trim() || "Set your location";

  return (
    <div className="space-y-6">
      <nav
        className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-black/50 px-4 py-3 backdrop-blur"
        aria-label="Branch locator"
      >
        <div className="flex flex-wrap items-center gap-6 text-sm font-medium">
          <Link href="/menu" className="text-white/70 transition hover:text-white">
            Menu
          </Link>
          <span className="font-semibold text-red-500">Branch Locator</span>
          <Link href="/menu" className="text-white/70 transition hover:text-white">
            Reservations
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="rounded-full p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
            aria-label="Search"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15ZM21 21l-4.35-4.35"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </nav>

      <div className="flex flex-col gap-2 border-b border-white/10 pb-6 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-white/45">
            Current location
          </p>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-white md:text-4xl">
            {queryCoords ? locationTitle : "Enable location"}
          </h1>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setViewMode("list")}
            className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
              viewMode === "list"
                ? "bg-red-600 text-white"
                : "border border-white/15 bg-black/40 text-white/65 hover:border-white/25"
            }`}
          >
            List view
          </button>
          <button
            type="button"
            onClick={() => setViewMode("map")}
            className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
              viewMode === "map"
                ? "bg-red-600 text-white"
                : "border border-white/15 bg-black/40 text-white/65 hover:border-white/25"
            }`}
          >
            Map view
          </button>
        </div>
      </div>

      {!queryCoords ? (
        <section className="relative overflow-hidden rounded-2xl border border-red-500/20 bg-gradient-to-br from-zinc-950 via-black to-zinc-900 p-10 md:p-14">
          <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-red-600/20 blur-3xl" />
          <div className="relative max-w-xl">
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-red-400/90">
              Foodies
            </p>
            <h2 className="mt-3 text-3xl font-black text-white md:text-5xl">
              Find your table. <span className="text-red-500">Tonight.</span>
            </h2>
            <p className="mt-4 text-sm text-white/65">
              Allow location to see branches near you, compare distance, and open the menu when
              you are ready.
            </p>
            <Button
              className="mt-8"
              onClick={requestLocation}
              disabled={locationStatus === "loading"}
            >
              {locationStatus === "loading" ? "Finding your location..." : "Use my location"}
            </Button>
            {locationStatus === "denied" ? (
              <p className="mt-4 text-sm text-red-300">
                Location is blocked in your browser. Enable it to browse branches.
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {queryCoords && branchesQuery.isLoading ? (
        <Loader label="Finding nearby branches..." />
      ) : null}

      {queryCoords && !branchesQuery.isLoading && !sortedBranches.length ? (
        <div className="rounded-xl border border-white/10 bg-black/40 p-6 text-sm text-[var(--muted)]">
          No branches found nearby. Try again with a different location.
        </div>
      ) : null}

      {queryCoords && sortedBranches.length > 0 && viewMode === "map" ? (
        <div className="overflow-hidden rounded-2xl border border-white/10 shadow-[0_0_0_1px_rgba(255,255,255,0.04)]">
          <BranchMap
            userLocation={queryCoords}
            branches={sortedBranches}
            onSelectBranch={(branch: Branch) => selectBranchAndGoToMenu(branch)}
            height="72vh"
          />
        </div>
      ) : null}

      {queryCoords && sortedBranches.length > 0 && viewMode === "list" ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start">
          <div className="flex max-h-[72vh] flex-col gap-4 overflow-y-auto pr-1">
            {sortedBranches.map((branch, i) => {
              const selected = selectedBranchId === branch.id;
              const km = distanceKmForBranch(branch);
              const featured = i === 0;
              return (
                <button
                  key={branch.id}
                  type="button"
                  onClick={() => selectBranchAndGoToMenu(branch)}
                  className={`relative overflow-hidden rounded-2xl border text-left transition ${
                    selected
                      ? "border-red-500/70 ring-2 ring-red-500/25"
                      : "border-white/10 hover:border-white/20"
                  }`}
                >
                  <div className="absolute inset-0">
                    <Image
                      src={branchCoverForBranch(branch)}
                      alt=""
                      fill
                      sizes="(max-width: 1024px) 100vw, 480px"
                      className="object-cover opacity-85"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/35" />
                  </div>
                  <div
                    className={`relative z-10 flex flex-col gap-4 p-6 ${featured ? "min-h-[320px]" : "min-h-[200px]"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span
                        className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${
                          selected
                            ? "bg-red-600 text-white"
                            : "border border-white/25 bg-black/60 text-white/90"
                        }`}
                      >
                        {selected ? "Currently selected" : "Open now"}
                      </span>
                      <span className="rounded-full border border-white/20 bg-black/60 px-3 py-1 text-[11px] font-semibold text-white">
                        {km != null ? `${kmToMi(km)} mi` : "Nearby"}
                      </span>
                    </div>
                    <div className="mt-auto">
                      <h3
                        className={`font-black text-white ${featured ? "text-2xl md:text-3xl" : "text-xl"}`}
                      >
                        {branch.name}
                      </h3>
                      <p className="mt-1 text-xs uppercase tracking-[0.2em] text-white/75">
                        {branch.address || branch.code || "Branch location"}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {getBranchTags(branch).map((tag) => (
                          <span
                            key={`${branch.id}-${tag}`}
                            className="rounded-full border border-white/20 bg-black/55 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white/90"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                      <p className="mt-4 text-xs text-white/70">
                        {featured
                          ? "Tap this card to open the menu."
                          : "Tap to open the menu."}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="sticky top-24 hidden overflow-hidden rounded-2xl border border-white/10 lg:block">
            <div className="relative border-b border-white/10 bg-black/60 px-4 py-3 text-xs text-white/60">
              <span className="font-semibold text-white/90">Map</span>
              <span className="ml-2 text-white/45">Tap a pin to select</span>
            </div>
            <BranchMap
              userLocation={queryCoords}
              branches={sortedBranches}
              onSelectBranch={(branch: Branch) => selectBranchAndGoToMenu(branch)}
              height="min(72vh, 640px)"
            />
            <div className="pointer-events-none absolute left-4 top-16 z-[500] max-w-[220px] rounded-lg border border-white/10 bg-black/80 p-3 text-[11px] text-white/70 shadow-xl backdrop-blur">
              <p className="font-semibold text-white">Exploring your area?</p>
              <p className="mt-1 text-white/55">Pick a branch, then continue to the menu.</p>
            </div>
          </div>
        </div>
      ) : null}

      <HomeContinueCard home={h} className="border-red-500/15 bg-black/40" />

      <footer className="mt-8 flex flex-col gap-4 border-t border-white/10 pt-8 text-xs text-white/45 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/foodies-logo.png"
            alt=""
            className="h-9 w-9 rounded-full object-cover ring-1 ring-white/15"
          />
          <span>
            © {new Date().getFullYear()} Foodies. Crafted in black & red.
          </span>
        </div>
        <div className="flex flex-wrap gap-4">
          <Link href="/support.html" className="hover:text-white/80">
            Support
          </Link>
          <Link href="/privacy-policy.html" className="hover:text-white/80">
            Privacy policy
          </Link>
          <Link href="/terms-and-conditions.html" className="hover:text-white/80">
            Terms
          </Link>
          <span className="text-red-500">Branch locator</span>
        </div>
      </footer>
    </div>
  );
}

"use client";

import Image from "next/image";
import { Button, Loader } from "@/components/ui";
import { BranchMap } from "@/components/home/branch-map-dynamic";
import { HomeContinueCard } from "@/components/home/home-continue-card";
import { useHomePage } from "@/lib/hooks/use-home-page";
import type { Branch } from "@/lib/api/types";

export function HomeDesignNeoGrid() {
  const h = useHomePage();
  const {
    queryCoords,
    locationStatus,
    requestLocation,
    viewMode,
    setViewMode,
    mapSectionRef,
    branchesQuery,
    sortedBranches,
    selectedBranchId,
    selectBranchAndGoToMenu,
    distanceKmForBranch,
    branchCoverForBranch,
    getBranchTags,
  } = h;

  return (
    <div className="border border-white/15 bg-[#070707]">
      <div className="border-b border-white/15 px-4 py-6 md:px-8">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-red-500">
              neo_grid // v1
            </p>
            <h1 className="mt-3 max-w-xl text-3xl font-black uppercase leading-none tracking-tighter text-white md:text-5xl">
              Branch
              <span className="text-red-600">_</span>
              matrix
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              className="rounded-none font-mono text-xs uppercase tracking-widest"
              onClick={requestLocation}
              disabled={locationStatus === "loading"}
            >
              {locationStatus === "loading" ? "…" : "Locate"}
            </Button>
          </div>
        </div>
        {locationStatus === "denied" ? (
          <p className="mt-4 font-mono text-xs text-red-400">ERR_LOCATION_DENIED</p>
        ) : null}
      </div>

      {!queryCoords ? (
        <div className="grid border-b border-white/15 md:grid-cols-2">
          <div className="border-b border-white/15 p-8 md:border-b-0 md:border-r">
            <p className="font-mono text-xs text-white/45">STATUS</p>
            <p className="mt-4 font-mono text-sm text-white/80">Awaiting coordinates</p>
            <p className="mt-2 max-w-sm font-mono text-xs leading-relaxed text-white/45">
              Geolocation unlocks the matrix. No coordinates, no tiles.
            </p>
          </div>
          <div className="relative min-h-[220px]">
            <Image
              src="https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=1200&q=80"
              alt=""
              fill
              className="object-cover opacity-60 grayscale"
              sizes="(max-width: 768px) 100vw, 50vw"
            />
            <div className="absolute inset-0 bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(255,255,255,0.03)_2px,rgba(255,255,255,0.03)_4px)]" />
          </div>
        </div>
      ) : null}

      {queryCoords ? (
        <div className="border-b border-white/15">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/15 px-4 py-4 md:px-8">
            <p className="font-mono text-xs uppercase tracking-[0.25em] text-white/55">
              Nodes · {sortedBranches.length}
            </p>
            <div className="flex gap-0 font-mono text-[10px] uppercase">
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={`border px-3 py-2 ${
                  viewMode === "list"
                    ? "border-red-600 bg-red-600 text-white"
                    : "border-white/20 text-white/55 hover:border-white/40"
                }`}
              >
                List
              </button>
              <button
                type="button"
                onClick={() => setViewMode("map")}
                className={`border border-l-0 px-3 py-2 ${
                  viewMode === "map"
                    ? "border-red-600 bg-red-600 text-white"
                    : "border-white/20 text-white/55 hover:border-white/40"
                }`}
              >
                Map
              </button>
            </div>
          </div>

          {branchesQuery.isLoading ? (
            <div className="p-8">
              <Loader label="Fetching nodes…" />
            </div>
          ) : null}

          {!branchesQuery.isLoading && !sortedBranches.length ? (
            <p className="p-8 font-mono text-sm text-[var(--muted)]">EMPTY_SET</p>
          ) : null}

          {sortedBranches.length > 0 && viewMode === "map" ? (
            <div ref={mapSectionRef} className="border-t border-white/15">
              <BranchMap
                userLocation={queryCoords}
                branches={sortedBranches}
                onSelectBranch={(b: Branch) => selectBranchAndGoToMenu(b)}
                height="68vh"
              />
            </div>
          ) : null}

          {sortedBranches.length > 0 && viewMode === "list" ? (
            <div className="grid gap-0 sm:grid-cols-2 lg:grid-cols-3">
              {sortedBranches.map((branch, i) => {
                const selected = selectedBranchId === branch.id;
                const km = distanceKmForBranch(branch);
                return (
                  <button
                    key={branch.id}
                    type="button"
                    onClick={() => selectBranchAndGoToMenu(branch)}
                    className={`group relative border-b border-white/15 text-left sm:border-r sm:[&:nth-child(2n)]:border-r-0 lg:[&:nth-child(3n)]:border-r-0 lg:[&:nth-child(3n+1)]:border-r lg:[&:nth-child(3n+2)]:border-r lg:[&:nth-child(3n+3)]:border-r-0 ${
                      selected ? "bg-red-950/25" : "hover:bg-white/[0.02]"
                    }`}
                  >
                    <div className="relative h-48 w-full overflow-hidden">
                      <Image
                        src={branchCoverForBranch(branch)}
                        alt=""
                        fill
                        className="object-cover opacity-80 transition duration-300 group-hover:opacity-100"
                        sizes="(max-width: 640px) 100vw, 33vw"
                      />
                      <div className="absolute left-3 top-3 font-mono text-[10px] text-white/80">
                        #{String(i + 1).padStart(2, "0")}
                      </div>
                    </div>
                    <div className="space-y-3 p-5">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-lg font-bold uppercase tracking-tight text-white">
                          {branch.name}
                        </p>
                        <span className="shrink-0 font-mono text-[10px] text-red-400">
                          {km != null ? `${km.toFixed(1)}km` : "—"}
                        </span>
                      </div>
                      <p className="font-mono text-[11px] leading-snug text-white/45">
                        {branch.address || branch.code || "—"}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {getBranchTags(branch).map((t) => (
                          <span
                            key={t}
                            className="border border-white/15 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-white/55"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="px-4 py-6 md:px-8">
        <HomeContinueCard home={h} className="rounded-none border border-white/15 bg-black font-mono text-xs" />
      </div>
    </div>
  );
}

"use client";

import Image from "next/image";
import { Button, Loader } from "@/components/ui";
import { BranchMap } from "@/components/home/branch-map-dynamic";
import { HomeContinueCard } from "@/components/home/home-continue-card";
import { HOME_IMAGE, useHomePage } from "@/lib/hooks/use-home-page";
import type { Branch } from "@/lib/api/types";

export function HomeDesignAurora() {
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
    <div className="relative overflow-hidden rounded-3xl">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,rgba(220,38,38,0.35),transparent_50%),radial-gradient(ellipse_at_80%_20%,rgba(120,20,20,0.35),transparent_45%),radial-gradient(ellipse_at_50%_100%,rgba(40,40,40,0.9),#020202)]" />
      <div className="pointer-events-none absolute inset-0 opacity-40 mix-blend-screen [background-image:linear-gradient(120deg,rgba(255,255,255,0.08)_0%,transparent_40%,rgba(255,255,255,0.06)_70%,transparent_100%)]" />

      <div className="relative space-y-10 px-1 py-2 md:px-4 md:py-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.4em] text-red-400/90">
            Aurora
          </p>
          <h1 className="mt-4 bg-gradient-to-br from-white via-white to-white/40 bg-clip-text text-4xl font-black tracking-tight text-transparent md:text-6xl">
            Heat & haze.
          </h1>
          <p className="mt-4 text-sm text-white/55">
            Glassmorphism meets midnight hunger — locate branches, glide the map, select, then
            continue.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button onClick={requestLocation} disabled={locationStatus === "loading"}>
              {locationStatus === "loading" ? "Pinpointing…" : "Share location"}
            </Button>
          </div>
          {locationStatus === "denied" ? (
            <p className="mt-4 text-sm text-red-300">Allow location in your browser settings.</p>
          ) : null}
        </div>

        {!queryCoords ? (
          <div className="relative mx-auto max-w-4xl overflow-hidden rounded-2xl border border-white/15 bg-white/5 p-1 shadow-[0_0_80px_rgba(220,38,38,0.12)] backdrop-blur-xl">
            <div className="relative h-56 overflow-hidden rounded-xl md:h-72">
              <Image
                src={HOME_IMAGE.branchB}
                alt=""
                fill
                className="object-cover opacity-70"
                sizes="(max-width: 896px) 100vw, 896px"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
              <p className="absolute bottom-5 left-5 right-5 text-center text-sm text-white/65">
                Location unlocks the aurora grid below.
              </p>
            </div>
          </div>
        ) : null}

        {queryCoords ? (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/30 p-4 backdrop-blur-md">
              <p className="text-sm font-medium text-white/80">Nearby branches</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setViewMode("list")}
                  className={`rounded-full px-4 py-1.5 text-xs font-semibold ${
                    viewMode === "list"
                      ? "bg-red-600 text-white shadow-lg shadow-red-600/25"
                      : "text-white/55 hover:text-white"
                  }`}
                >
                  Grid
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("map")}
                  className={`rounded-full px-4 py-1.5 text-xs font-semibold ${
                    viewMode === "map"
                      ? "bg-red-600 text-white shadow-lg shadow-red-600/25"
                      : "text-white/55 hover:text-white"
                  }`}
                >
                  Map
                </button>
              </div>
            </div>

            {branchesQuery.isLoading ? <Loader label="Gathering venues…" /> : null}

            {!branchesQuery.isLoading && !sortedBranches.length ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-[var(--muted)] backdrop-blur">
                No branches in range. Try another location.
              </div>
            ) : null}

            {sortedBranches.length > 0 && viewMode === "map" ? (
              <div
                ref={mapSectionRef}
                className="overflow-hidden rounded-2xl border border-white/15 bg-black/40 shadow-[0_20px_80px_rgba(0,0,0,0.55)] backdrop-blur"
              >
                <BranchMap
                  userLocation={queryCoords}
                  branches={sortedBranches}
                  onSelectBranch={(b: Branch) => selectBranchAndGoToMenu(b)}
                  height="68vh"
                />
              </div>
            ) : null}

            {sortedBranches.length > 0 && viewMode === "list" ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {sortedBranches.map((branch) => {
                  const selected = selectedBranchId === branch.id;
                  const km = distanceKmForBranch(branch);
                  return (
                    <button
                      key={branch.id}
                      type="button"
                      onClick={() => selectBranchAndGoToMenu(branch)}
                      className={`group relative overflow-hidden rounded-2xl border text-left transition ${
                        selected
                          ? "border-red-500/60 bg-red-950/20 shadow-[0_0_40px_rgba(220,38,38,0.18)]"
                          : "border-white/10 bg-white/[0.03] hover:border-white/20"
                      }`}
                    >
                      <div className="relative h-44 w-full">
                        <Image
                          src={branchCoverForBranch(branch)}
                          alt=""
                          fill
                          className="object-cover opacity-85 transition duration-500 group-hover:scale-[1.03]"
                          sizes="(max-width: 640px) 100vw, 400px"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-transparent" />
                      </div>
                      <div className="space-y-2 p-4">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-red-300/90">
                            {selected ? "Active" : "Available"}
                          </span>
                          <span className="text-xs text-white/55">
                            {km != null ? `${km.toFixed(1)} km` : "—"}
                          </span>
                        </div>
                        <p className="text-lg font-bold text-white">{branch.name}</p>
                        <p className="line-clamp-2 text-xs text-white/50">
                          {branch.address || branch.code || ""}
                        </p>
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {getBranchTags(branch).map((t) => (
                            <span
                              key={t}
                              className="rounded-full border border-white/10 bg-black/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/70"
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

        <HomeContinueCard home={h} className="border-white/15 bg-white/[0.04] backdrop-blur-xl" />
      </div>
    </div>
  );
}

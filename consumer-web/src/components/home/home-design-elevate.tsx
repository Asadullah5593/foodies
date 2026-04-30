"use client";

import Image from "next/image";
import { Button, Loader } from "@/components/ui";
import { BranchMap } from "@/components/home/branch-map-dynamic";
import { HomeContinueCard } from "@/components/home/home-continue-card";
import { HOME_IMAGE, useHomePage } from "@/lib/hooks/use-home-page";
import type { Branch } from "@/lib/api/types";

export function HomeDesignElevate() {
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
    distanceSubLabel,
  } = h;

  return (
    <div className="overflow-hidden rounded-3xl">
      <section className="relative isolate min-h-[420px] md:min-h-[480px]">
        <Image
          src={HOME_IMAGE.hero}
          alt=""
          fill
          priority
          className="object-cover"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/80 to-black/20" />
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(220,38,38,0.35)_0%,transparent_38%,transparent_62%,rgba(0,0,0,0.85)_100%)]" />

        <div className="relative z-10 flex h-full min-h-[420px] flex-col justify-end px-6 pb-12 pt-24 md:min-h-[480px] md:px-12 md:pb-16">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.35em] text-red-400">
              Elevate
            </p>
            <h1 className="mt-4 text-4xl font-black leading-[0.95] text-white md:text-6xl">
              Rise into
              <span className="block text-red-500">the kitchen lights.</span>
            </h1>
            <p className="mt-5 max-w-lg text-sm text-white/65">
              Location first. Then a cinematic branch gallery or a full-bleed map — your call.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button onClick={requestLocation} disabled={locationStatus === "loading"}>
                {locationStatus === "loading" ? "Locating…" : "Enable location"}
              </Button>
            </div>
            {locationStatus === "denied" ? (
              <p className="mt-4 text-sm text-red-200">Location blocked — allow access to browse.</p>
            ) : null}
          </div>
        </div>
      </section>

      {queryCoords ? (
        <section className="relative -mt-10 space-y-8 rounded-t-3xl border border-white/10 bg-[var(--background)] px-4 py-10 shadow-[0_-30px_80px_rgba(0,0,0,0.65)] md:px-10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-black text-white">Pick a branch</h2>
              <p className="text-sm text-white/45">Closest first. Tap to commit your selection.</p>
            </div>
            <div className="inline-flex rounded-full border border-white/10 bg-black/40 p-1">
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={`rounded-full px-4 py-2 text-xs font-semibold ${
                  viewMode === "list" ? "bg-red-600 text-white" : "text-white/55"
                }`}
              >
                Gallery
              </button>
              <button
                type="button"
                onClick={() => setViewMode("map")}
                className={`rounded-full px-4 py-2 text-xs font-semibold ${
                  viewMode === "map" ? "bg-red-600 text-white" : "text-white/55"
                }`}
              >
                Map
              </button>
            </div>
          </div>

          {branchesQuery.isLoading ? <Loader label="Loading branches…" /> : null}

          {!branchesQuery.isLoading && !sortedBranches.length ? (
            <p className="rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-[var(--muted)]">
              No branches nearby. Adjust your location and try again.
            </p>
          ) : null}

          {sortedBranches.length > 0 && viewMode === "map" ? (
            <div ref={mapSectionRef} className="overflow-hidden rounded-2xl border border-white/10">
              <BranchMap
                userLocation={queryCoords}
                branches={sortedBranches}
                onSelectBranch={(b: Branch) => selectBranchAndGoToMenu(b)}
                height="70vh"
              />
            </div>
          ) : null}

          {sortedBranches.length > 0 && viewMode === "list" ? (
            <div className="grid gap-5 md:grid-cols-2">
              {sortedBranches.map((branch, index) => {
                const selected = selectedBranchId === branch.id;
                const km = distanceKmForBranch(branch);
                const large = index === 0;
                return (
                  <button
                    key={branch.id}
                    type="button"
                    onClick={() => selectBranchAndGoToMenu(branch)}
                    className={`relative overflow-hidden rounded-2xl border text-left transition ${
                      large ? "md:col-span-2" : ""
                    } ${
                      selected
                        ? "border-red-500/60 shadow-[0_0_0_1px_rgba(239,68,68,0.25)]"
                        : "border-white/10 hover:border-white/20"
                    }`}
                  >
                    <div className={`relative w-full ${large ? "h-72" : "h-56"}`}>
                      <Image
                        src={branchCoverForBranch(branch)}
                        alt=""
                        fill
                        className="object-cover"
                        sizes="(max-width: 768px) 100vw, 50vw"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/55 to-transparent" />
                    </div>
                    <div className="absolute inset-x-0 bottom-0 p-6">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-2xl font-black text-white md:text-3xl">{branch.name}</p>
                        <span className="rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-white/85 ring-1 ring-white/15">
                          {km != null ? distanceSubLabel(km) : "Nearby"}
                        </span>
                      </div>
                      <p className="mt-2 max-w-2xl text-sm text-white/60">
                        {branch.address || branch.code || ""}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {getBranchTags(branch).map((t) => (
                          <span
                            key={t}
                            className="rounded-full border border-white/15 bg-black/45 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-white/80"
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

          <HomeContinueCard home={h} />
        </section>
      ) : null}
    </div>
  );
}

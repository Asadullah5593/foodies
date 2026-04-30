"use client";

import Image from "next/image";
import { Button, Loader } from "@/components/ui";
import { BranchMap } from "@/components/home/branch-map-dynamic";
import { HomeContinueCard } from "@/components/home/home-continue-card";
import { HOME_IMAGE, useHomePage } from "@/lib/hooks/use-home-page";
import type { Branch } from "@/lib/api/types";

export function HomeDesignVelvet() {
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
    <div className="relative overflow-hidden rounded-[2rem] border border-red-950/40 bg-[#0a0304] shadow-[0_0_120px_rgba(127,29,29,0.25)]">
      <div className="pointer-events-none absolute -left-32 top-0 h-96 w-96 rounded-full bg-red-900/25 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-80 w-80 rounded-full bg-black blur-3xl" />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'%3E%3Cg fill='none' stroke='%23ffffff' stroke-width='0.5'%3E%3Cpath d='M0 0h80v80H0z'/%3E%3C/g%3E%3C/svg%3E\")",
        }}
      />

      <div className="relative space-y-12 px-4 py-8 md:px-10 md:py-12">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.55em] text-red-300/70">
            Velvet room
          </p>
          <h1 className="mt-5 font-serif text-4xl italic text-white md:text-6xl">
            Foodies
            <span className="not-italic font-sans text-3xl font-black text-red-500 md:text-5xl">
              {" "}
              after dark
            </span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-sm leading-relaxed text-red-100/55">
            A velvet curtain of red on black — share your location, explore branches in list or map,
            select your venue, then continue when the menu is ready.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Button
              className="rounded-full bg-gradient-to-r from-red-700 to-red-600 px-8 shadow-lg shadow-red-900/40"
              onClick={requestLocation}
              disabled={locationStatus === "loading"}
            >
              {locationStatus === "loading" ? "Finding you…" : "Allow location"}
            </Button>
          </div>
          {locationStatus === "denied" ? (
            <p className="mt-4 text-sm text-red-300/90">We need location to show nearby rooms.</p>
          ) : null}
        </div>

        {!queryCoords ? (
          <div className="relative mx-auto max-w-4xl overflow-hidden rounded-3xl border border-red-900/30">
            <Image
              src={HOME_IMAGE.branchC}
              alt=""
              width={1400}
              height={720}
              className="h-64 w-full object-cover opacity-75 md:h-80"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0a0304] via-transparent to-transparent" />
            <p className="absolute bottom-6 left-0 right-0 text-center text-sm text-red-100/55">
              Your nearest Foodies branch appears here once location is on.
            </p>
          </div>
        ) : null}

        {queryCoords ? (
          <div className="space-y-8">
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-red-900/35 bg-gradient-to-r from-black/60 via-red-950/20 to-black/60 p-4">
              <p className="font-serif text-lg text-red-50">Nearby salons</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setViewMode("list")}
                  className={`rounded-full px-5 py-2 text-xs font-semibold uppercase tracking-wider ${
                    viewMode === "list"
                      ? "bg-red-600 text-white"
                      : "border border-red-900/50 text-red-200/60 hover:text-red-100"
                  }`}
                >
                  Cards
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("map")}
                  className={`rounded-full px-5 py-2 text-xs font-semibold uppercase tracking-wider ${
                    viewMode === "map"
                      ? "bg-red-600 text-white"
                      : "border border-red-900/50 text-red-200/60 hover:text-red-100"
                  }`}
                >
                  Map
                </button>
              </div>
            </div>

            {branchesQuery.isLoading ? <Loader label="Opening the velvet list…" /> : null}

            {!branchesQuery.isLoading && !sortedBranches.length ? (
              <p className="rounded-2xl border border-red-900/30 bg-black/40 p-8 text-center text-sm text-red-100/45">
                No branches in this area yet.
              </p>
            ) : null}

            {sortedBranches.length > 0 && viewMode === "map" ? (
              <div
                ref={mapSectionRef}
                className="overflow-hidden rounded-3xl border border-red-900/40 shadow-[0_30px_90px_rgba(0,0,0,0.65)]"
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
              <div className="grid gap-6 md:grid-cols-2">
                {sortedBranches.map((branch) => {
                  const selected = selectedBranchId === branch.id;
                  const km = distanceKmForBranch(branch);
                  return (
                    <button
                      key={branch.id}
                      type="button"
                      onClick={() => selectBranchAndGoToMenu(branch)}
                      className={`relative overflow-hidden rounded-3xl border text-left transition ${
                        selected
                          ? "border-red-400/60 shadow-[0_0_60px_rgba(220,38,38,0.22)]"
                          : "border-red-950/50 hover:border-red-800/60"
                      }`}
                    >
                      <div className="relative h-52 w-full">
                        <Image
                          src={branchCoverForBranch(branch)}
                          alt=""
                          fill
                          className="object-cover opacity-90"
                          sizes="(max-width: 768px) 100vw, 50vw"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0304] via-[#0a0304]/55 to-transparent" />
                        <div className="absolute left-5 top-5 rounded-full border border-red-400/30 bg-black/50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-red-100">
                          {selected ? "Chosen" : "Salon"}
                        </div>
                      </div>
                      <div className="space-y-2 px-6 pb-6 pt-4">
                        <div className="flex items-start justify-between gap-3">
                          <p className="font-serif text-2xl text-red-50">{branch.name}</p>
                          <span className="shrink-0 rounded-full border border-red-900/50 bg-black/40 px-2 py-1 text-[11px] text-red-200/70">
                            {km != null ? `${km.toFixed(1)} km` : "Near"}
                          </span>
                        </div>
                        <p className="text-sm text-red-100/45">
                          {branch.address || branch.code || ""}
                        </p>
                        <div className="flex flex-wrap gap-2 pt-2">
                          {getBranchTags(branch).map((t) => (
                            <span
                              key={t}
                              className="rounded-full border border-red-900/40 px-3 py-1 text-[10px] uppercase tracking-widest text-red-200/70"
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

        <HomeContinueCard home={h} className="border-red-900/40 bg-gradient-to-br from-black/80 to-red-950/25" />
      </div>
    </div>
  );
}

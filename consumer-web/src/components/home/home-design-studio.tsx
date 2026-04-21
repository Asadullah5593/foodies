"use client";

import Image from "next/image";
import Link from "next/link";
import { Button, Loader } from "@/components/ui";
import { BranchMap } from "@/components/home/branch-map-dynamic";
import { HomeContinueCard } from "@/components/home/home-continue-card";
import { useHomePage } from "@/lib/hooks/use-home-page";
import type { Branch } from "@/lib/api/types";

export function HomeDesignStudio() {
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
    setSelectedBranch,
    distanceKmForBranch,
    branchCoverForBranch,
    getBranchTags,
  } = h;

  return (
    <div className="mx-auto max-w-5xl space-y-16">
      <header className="grid gap-10 border-b border-white/10 pb-16 md:grid-cols-[1.1fr_0.9fr] md:items-end">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.55em] text-white/35">
            Foodies / Studio
          </p>
          <h1 className="mt-6 text-4xl font-light tracking-tight text-white md:text-5xl">
            Precision dining,
            <span className="font-semibold text-red-500"> measured in miles.</span>
          </h1>
        </div>
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-white/50">
            Enable location to query nearby branches. Select one branch to unlock the menu when
            brands are available.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              className="border border-white/15 bg-transparent text-white hover:bg-white/5"
              onClick={requestLocation}
              disabled={locationStatus === "loading"}
            >
              {locationStatus === "loading" ? "Working…" : "Use location"}
            </Button>
            <Link
              href="/login"
              className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium text-red-500 underline-offset-4 hover:underline"
            >
              Sign in
            </Link>
          </div>
          {locationStatus === "denied" ? (
            <p className="text-sm text-red-400/90">Location unavailable.</p>
          ) : null}
        </div>
      </header>

      {!queryCoords ? (
        <div className="grid gap-px overflow-hidden rounded-sm bg-white/10 md:grid-cols-3">
          <div className="bg-black p-8 md:col-span-2">
            <p className="text-xs uppercase tracking-[0.3em] text-white/35">01</p>
            <p className="mt-6 max-w-md text-lg leading-snug text-white/75">
              The studio frame stays quiet until you share coordinates.
            </p>
          </div>
          <div className="relative min-h-[200px] bg-zinc-950">
            <Image
              src="https://images.unsplash.com/photo-1559339352-11d035aa65de?auto=format&fit=crop&w=900&q=80"
              alt=""
              fill
              className="object-cover opacity-70"
              sizes="400px"
            />
          </div>
        </div>
      ) : null}

      {queryCoords ? (
        <section className="space-y-8">
          <div className="flex items-center justify-between gap-6">
            <h2 className="text-xs font-medium uppercase tracking-[0.45em] text-white/35">
              Branches
            </h2>
            <div className="flex gap-px bg-white/10 p-px">
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={`min-w-[96px] px-4 py-2 text-xs font-medium uppercase tracking-wider ${
                  viewMode === "list" ? "bg-white text-black" : "bg-black text-white/55"
                }`}
              >
                List
              </button>
              <button
                type="button"
                onClick={() => setViewMode("map")}
                className={`min-w-[96px] px-4 py-2 text-xs font-medium uppercase tracking-wider ${
                  viewMode === "map" ? "bg-white text-black" : "bg-black text-white/55"
                }`}
              >
                Map
              </button>
            </div>
          </div>

          {branchesQuery.isLoading ? <Loader label="Loading…" /> : null}

          {!branchesQuery.isLoading && !sortedBranches.length ? (
            <p className="border border-dashed border-white/15 p-10 text-center text-sm text-[var(--muted)]">
              No results.
            </p>
          ) : null}

          {sortedBranches.length > 0 && viewMode === "map" ? (
            <div ref={mapSectionRef} className="overflow-hidden border border-white/10">
              <BranchMap
                userLocation={queryCoords}
                branches={sortedBranches}
                onSelectBranch={(b: Branch) => setSelectedBranch(b)}
                height="64vh"
              />
            </div>
          ) : null}

          {sortedBranches.length > 0 && viewMode === "list" ? (
            <ul className="divide-y divide-white/10 border border-white/10">
              {sortedBranches.map((branch) => {
                const selected = selectedBranchId === branch.id;
                const km = distanceKmForBranch(branch);
                return (
                  <li key={branch.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedBranch(branch)}
                      className={`flex w-full gap-6 p-6 text-left transition hover:bg-white/[0.02] ${
                        selected ? "bg-red-950/10" : ""
                      }`}
                    >
                      <div className="relative h-24 w-32 shrink-0 overflow-hidden border border-white/10">
                        <Image
                          src={branchCoverForBranch(branch)}
                          alt=""
                          fill
                          className="object-cover"
                          sizes="128px"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="truncate text-lg font-medium text-white">{branch.name}</p>
                          <span className="shrink-0 text-xs tabular-nums text-white/40">
                            {km != null ? `${km.toFixed(1)} km` : "—"}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-white/40">
                          {branch.address || branch.code || ""}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {getBranchTags(branch).map((t) => (
                            <span key={t} className="text-[10px] uppercase tracking-[0.2em] text-red-400/80">
                              {t}
                            </span>
                          ))}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
      ) : null}

      <HomeContinueCard home={h} className="border-white/10 bg-transparent" />

      <footer className="border-t border-white/10 pt-10 text-center text-[10px] uppercase tracking-[0.4em] text-white/25">
        Foodies studio
      </footer>
    </div>
  );
}

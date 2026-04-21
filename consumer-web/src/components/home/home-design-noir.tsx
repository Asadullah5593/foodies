"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { Button, Loader } from "@/components/ui";
import { BranchMap } from "@/components/home/branch-map-dynamic";
import { HomeContinueCard } from "@/components/home/home-continue-card";
import { HOME_IMAGE, useHomePage } from "@/lib/hooks/use-home-page";
import type { Branch } from "@/lib/api/types";

export function HomeDesignNoir() {
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
    distanceSubLabel,
  } = h;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35 }}
      className="relative"
    >
      <div className="pointer-events-none absolute left-0 top-0 h-40 w-px bg-gradient-to-b from-red-600 via-red-600/40 to-transparent md:h-56" />

      <header className="relative border-b border-white/10 pb-10 pl-6 md:pl-10">
        <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-red-500">
          Foodies noir
        </p>
        <h1 className="mt-4 max-w-3xl text-4xl font-black leading-[0.95] tracking-tight text-white md:text-6xl">
          Night falls.
          <span className="block text-white/40">Flavor rises.</span>
        </h1>
        <p className="mt-6 max-w-xl text-sm leading-relaxed text-white/55">
          Choose your coordinates. We surface the closest kitchens, then you pick the branch that
          fits the night.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button onClick={requestLocation} disabled={locationStatus === "loading"}>
            {locationStatus === "loading" ? "Locating…" : "Reveal nearby branches"}
          </Button>
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-white/85 transition hover:bg-white/5"
          >
            Member access
          </Link>
        </div>
        {locationStatus === "denied" ? (
          <p className="mt-4 text-sm text-red-300">Location permission is required.</p>
        ) : null}
      </header>

      {queryCoords ? (
        <section className="mt-12 space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-white">Branches near you</h2>
              <p className="text-sm text-white/45">Sorted by distance. Tap to select.</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wider ${
                  viewMode === "list" ? "bg-red-600 text-white" : "text-white/50 hover:text-white"
                }`}
              >
                List
              </button>
              <button
                type="button"
                onClick={() => setViewMode("map")}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wider ${
                  viewMode === "map" ? "bg-red-600 text-white" : "text-white/50 hover:text-white"
                }`}
              >
                Map
              </button>
            </div>
          </div>

          {branchesQuery.isLoading ? <Loader label="Scanning the city…" /> : null}

          {!branchesQuery.isLoading && !sortedBranches.length ? (
            <p className="rounded-lg border border-white/10 bg-black/30 p-6 text-sm text-[var(--muted)]">
              Nothing nearby yet. Adjust location and try again.
            </p>
          ) : null}

          {sortedBranches.length > 0 && viewMode === "map" ? (
            <div ref={mapSectionRef} className="overflow-hidden rounded-xl border border-white/10">
              <BranchMap
                userLocation={queryCoords}
                branches={sortedBranches}
                onSelectBranch={(b: Branch) => setSelectedBranch(b)}
                height="70vh"
              />
            </div>
          ) : null}

          {sortedBranches.length > 0 && viewMode === "list" ? (
            <div className="flex gap-4 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {sortedBranches.map((branch) => {
                const selected = selectedBranchId === branch.id;
                const km = distanceKmForBranch(branch);
                return (
                  <button
                    key={branch.id}
                    type="button"
                    onClick={() => setSelectedBranch(branch)}
                    className={`relative h-[420px] w-[min(88vw,340px)] shrink-0 overflow-hidden rounded-2xl border text-left transition ${
                      selected
                        ? "border-red-500 shadow-[0_0_0_1px_rgba(239,68,68,0.35)]"
                        : "border-white/10 hover:border-white/20"
                    }`}
                  >
                    <Image
                      src={branchCoverForBranch(branch)}
                      alt=""
                      fill
                      className="object-cover opacity-90"
                      sizes="340px"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/55 to-transparent" />
                    <div className="absolute inset-x-0 bottom-0 p-5">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-red-400/90">
                        {selected ? "Selected" : "Branch"}
                      </p>
                      <p className="mt-2 text-2xl font-black text-white">{branch.name}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-white/60">
                        {branch.address || branch.code || ""}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {getBranchTags(branch).map((t) => (
                          <span
                            key={t}
                            className="rounded border border-white/15 bg-black/50 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/75"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                      <p className="mt-4 text-xs font-semibold text-white/80">
                        {km != null ? distanceSubLabel(km) : "Nearby"}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : null}
        </section>
      ) : (
        <div className="relative mt-12 overflow-hidden rounded-2xl border border-white/10">
          <Image
            src={HOME_IMAGE.hero}
            alt=""
            width={1600}
            height={900}
            className="h-64 w-full object-cover opacity-50 md:h-80"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/20" />
          <p className="absolute bottom-6 left-6 max-w-sm text-sm text-white/60">
            Enable location to unlock the horizontal branch rail and map.
          </p>
        </div>
      )}

      <HomeContinueCard home={h} className="mt-10 border-white/10 bg-zinc-950/80" />

      <footer className="mt-14 flex justify-between border-t border-white/10 pt-8 text-[11px] uppercase tracking-[0.2em] text-white/35">
        <span>Foodies</span>
        <span>{new Date().getFullYear()}</span>
      </footer>
    </motion.div>
  );
}

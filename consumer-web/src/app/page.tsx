"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { TopNav } from "@/components/top-nav";
import { AppShell, Button, Card, Loader, SectionTitle } from "@/components/ui";
import { BranchMap } from "@/components/home/branch-map-dynamic";
import { HOME_IMAGE, useHomePage } from "@/lib/hooks/use-home-page";
import type { Branch } from "@/lib/api/types";

export default function Home() {
  const h = useHomePage();
  const {
    router,
    queryCoords,
    locationStatus,
    requestLocation,
    viewMode,
    setViewMode,
    mapSectionRef,
    branchesQuery,
    selectedBranchBrandsQuery,
    sortedBranches,
    selectedBranchId,
    setSelectedBranch,
    distanceKmForBranch,
    branchCoverForBranch,
    getBranchTags,
    distanceSubLabel,
    selectedBranchHasBrands,
  } = h;

  return (
    <AppShell>
      <TopNav />
      <motion.section
        initial={false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
        <section className="relative overflow-hidden rounded-2xl border border-white/10 bg-black">
          <div className="absolute inset-0">
            <Image
              src={HOME_IMAGE.hero}
              alt=""
              fill
              priority
              sizes="(max-width: 1280px) 100vw, 1280px"
              className="object-cover opacity-80"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/55 to-black/20" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_25%,rgba(220,38,38,0.25),transparent_45%)]" />
          </div>

          <div className="relative z-10 px-6 py-10 md:px-10 md:py-16">
            <div className="max-w-2xl">
              <p className="mb-3 text-xs font-bold uppercase tracking-[0.22em] text-white/70">
                We are open for experience
              </p>
              <h1 className="text-4xl font-black leading-[0.98] tracking-tight text-white md:text-6xl">
                TASTE THE <span className="text-red-500">UNEXPECTED</span>.
              </h1>
              <p className="mt-4 max-w-xl text-sm text-white/70 md:text-base">
                A curated collection of culinary destinations designed for the discerning
                palate. Select your locale, then explore what’s cooking tonight.
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Button onClick={requestLocation} disabled={locationStatus === "loading"}>
                  {locationStatus === "loading"
                    ? "Finding your location..."
                    : "Choose your location"}
                </Button>
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center rounded-lg border border-[var(--border-soft)] bg-[var(--surface)]/65 px-4 py-2 text-sm font-semibold text-[var(--foreground)] transition hover:bg-[var(--surface-2)]"
                >
                  Member login
                </Link>
              </div>

              {locationStatus === "denied" ? (
                <p className="mt-4 text-sm text-red-300">
                  Location access is blocked. Please allow location to show nearby
                  branches.
                </p>
              ) : null}
              {queryCoords ? (
                <p className="mt-4 text-sm text-emerald-300">
                  Location enabled successfully.
                  {queryCoords
                    ? ` (${queryCoords.latitude.toFixed(6)}, ${queryCoords.longitude.toFixed(6)})`
                    : ""}
                </p>
              ) : null}
            </div>
          </div>
        </section>

        {queryCoords ? (
          <section className="mt-8">
            <div className="mb-4 flex items-center justify-between">
              <SectionTitle
                title="Our branches"
                subtitle="Only branches are shown here. Continue to menu after selecting one."
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                    viewMode === "list"
                      ? "bg-red-600 text-white"
                      : "border border-white/10 bg-black/40 text-white/70"
                  }`}
                  onClick={() => setViewMode("list")}
                >
                  List view
                </button>
                <button
                  type="button"
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                    viewMode === "map"
                      ? "bg-red-600 text-white"
                      : "border border-white/10 bg-black/40 text-white/70"
                  }`}
                  onClick={() => setViewMode("map")}
                >
                  Map view
                </button>
              </div>
            </div>

            {branchesQuery.isLoading ? <Loader label="Finding nearby branches..." /> : null}

            {!branchesQuery.isLoading && !sortedBranches.length ? (
              <Card>
                <p className="text-sm text-[var(--muted)]">
                  No branches found nearby. Try again with a different location.
                </p>
              </Card>
            ) : null}

            {sortedBranches.length ? (
              viewMode === "map" ? (
                <div ref={mapSectionRef}>
                  <BranchMap
                    userLocation={queryCoords}
                    branches={sortedBranches}
                    onSelectBranch={(branch: Branch) => setSelectedBranch(branch)}
                    height="72vh"
                  />
                </div>
              ) : (
                <div className="grid gap-4 lg:grid-cols-6">
                  {sortedBranches.map((branch, index) => {
                    const selected = selectedBranchId === branch.id;
                    const km = distanceKmForBranch(branch);
                    const spanClass =
                      index === 0
                        ? "lg:col-span-4"
                        : index === 1
                          ? "lg:col-span-2"
                          : index === 2
                            ? "lg:col-span-2"
                            : index === 3
                              ? "lg:col-span-4"
                              : "lg:col-span-2";
                    return (
                      <button
                        key={branch.id}
                        type="button"
                        onClick={() => setSelectedBranch(branch)}
                        className={`group relative overflow-hidden rounded-2xl border text-left transition ${spanClass} ${
                          selected
                            ? "border-red-500/60 ring-1 ring-red-500/30"
                            : "border-white/10 hover:border-white/20"
                        }`}
                      >
                        <div className="absolute inset-0">
                          <Image
                            src={branchCoverForBranch(branch)}
                            alt=""
                            fill
                            sizes="(max-width: 1280px) 100vw, 720px"
                            className="object-cover opacity-80 transition duration-300 group-hover:scale-[1.02]"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/65 to-black/45" />
                          <div className="absolute inset-0 bg-black/25" />
                        </div>

                        <div className="relative z-10 flex h-full min-h-[328px] flex-col justify-between p-5">
                          <div className="flex items-center justify-between gap-3">
                            <span className="rounded-full border border-white/25 bg-black/65 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
                              {selected ? "Selected" : "Open now"}
                            </span>
                            <span className="rounded-full border border-white/20 bg-black/65 px-3 py-1 text-[11px] font-semibold text-white">
                              {km != null ? `${km.toFixed(1)} km away` : "Nearby"}
                            </span>
                          </div>

                          <div>
                            <p className="text-2xl font-extrabold text-white [text-shadow:0_2px_10px_rgba(0,0,0,0.95)]">
                              {branch.name}
                            </p>
                            <p className="mt-1 text-xs uppercase tracking-[0.18em] text-white/90 [text-shadow:0_2px_8px_rgba(0,0,0,0.9)]">
                              {branch.address || branch.code || "Branch location"}
                            </p>
                            <div className="mt-4 flex flex-wrap items-center gap-2">
                              {getBranchTags(branch).map((tag) => (
                                <span
                                  key={`${branch.id}-${tag}`}
                                  className="rounded-full border border-white/25 bg-black/65 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-white"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                            <div className="mt-5 flex items-center justify-between gap-3">
                              <span className="inline-flex items-center gap-2 text-xs font-semibold text-white [text-shadow:0_2px_8px_rgba(0,0,0,0.9)]">
                                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/70 ring-1 ring-white/20">
                                  <svg
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    aria-hidden="true"
                                  >
                                    <path
                                      d="M12 22s7-4.5 7-12a7 7 0 1 0-14 0c0 7.5 7 12 7 12Z"
                                      stroke="currentColor"
                                      strokeWidth="1.6"
                                      strokeLinejoin="round"
                                    />
                                    <path
                                      d="M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
                                      stroke="currentColor"
                                      strokeWidth="1.6"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                </span>
                                {km != null ? distanceSubLabel(km) : "View on map"}
                              </span>
                              <span className="rounded-lg border border-white/25 bg-black/70 px-3 py-2 text-xs font-semibold text-white transition group-hover:bg-black/80">
                                {selected ? "Selected" : "Select Branch"}
                              </span>
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )
            ) : null}
          </section>
        ) : null}

        {selectedBranchId ? (
          <Card className="mt-6">
            {selectedBranchBrandsQuery.isLoading ? (
              <Loader label="Checking brands for selected branch..." />
            ) : selectedBranchHasBrands ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-[var(--muted)]">
                  Branch selected. Explore curated brands for this branch.
                </p>
                <Button onClick={() => router.push("/brands")}>Go to brands</Button>
              </div>
            ) : (
              <p className="text-sm text-[var(--muted)]">
                This branch has no brands yet. Please choose another branch to continue.
              </p>
            )}
          </Card>
        ) : null}

        <footer className="mt-12 border-t border-white/10 py-8 text-xs text-white/55">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <p className="tracking-wide">
              © {new Date().getFullYear()} Culinary Hub. All rights reserved.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <Link href="/" className="hover:text-white/80">
                Experience
              </Link>
              <Link href="/" className="hover:text-white/80">
                Company
              </Link>
              <Link href="/" className="hover:text-white/80">
                Legal
              </Link>
            </div>
          </div>
        </footer>
      </motion.section>
    </AppShell>
  );
}

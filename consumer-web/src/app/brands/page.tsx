"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BrandCard } from "@/components/brand-card";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { AppShell, Card, Input, Loader } from "@/components/ui";
import { getTenantBrands } from "@/lib/api/consumer";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";

/** Brands per page in the all-brands grid. */
const PAGE_SIZE = 12;

/** Compact, windowed list of page numbers (with ellipses) for the pager. */
function pageWindow(current: number, total: number): Array<number | "…"> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: Array<number | "…"> = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push("…");
  for (let p = start; p <= end; p += 1) pages.push(p);
  if (end < total - 1) pages.push("…");
  pages.push(total);
  return pages;
}

export default function BrandsPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebouncedValue(search.trim(), 250);

  const brandsQuery = useQuery({
    queryKey: ["tenant-brands"],
    queryFn: () => getTenantBrands(),
    refetchOnMount: "always",
    refetchOnReconnect: true,
    staleTime: 0,
  });

  const brands = useMemo(() => brandsQuery.data ?? [], [brandsQuery.data]);

  const filtered = useMemo(() => {
    const q = debounced.toLowerCase();
    if (!q) return brands;
    return brands.filter((b) => (b.name ?? "").toLowerCase().includes(q));
  }, [brands, debounced]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  // Reset to the first page whenever the (debounced) search changes. Done during
  // render — per the codebase convention — instead of in an effect.
  const [prevDebounced, setPrevDebounced] = useState(debounced);
  if (prevDebounced !== debounced) {
    setPrevDebounced(debounced);
    setPage(1);
  }

  const pageBrands = useMemo(
    () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filtered, currentPage],
  );

  const goToPage = (p: number) => {
    setPage(Math.min(Math.max(1, p), totalPages));
    if (typeof window !== "undefined") {
      document.getElementById("all-brands")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <AppShell>
      <SiteHeader />

      <section id="all-brands" className="mt-2">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.18em] text-red-600 hover:underline"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M19 12H5M11 18l-6-6 6-6" />
              </svg>
              Back to home
            </Link>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-[var(--foreground)] md:text-4xl">
              All Brands
            </h1>
            <div className="mt-2 h-[3px] w-10 rounded-full bg-red-600 md:w-12" aria-hidden="true" />
            <p className="mt-2 text-sm text-[var(--muted)]">
              Browse every brand at Foodies Food Court and jump straight into its menu.
            </p>
          </div>

          <div className="w-full md:w-72">
            <label htmlFor="brand-search" className="sr-only">
              Search brands
            </label>
            <Input
              id="brand-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search brands..."
              autoComplete="off"
            />
          </div>
        </div>

        {brandsQuery.isLoading ? (
          <div className="mt-8">
            <Loader label="Loading brands..." />
          </div>
        ) : null}

        {!brandsQuery.isLoading && !brands.length ? (
          <div className="mt-8">
            <Card>
              <p className="text-sm text-[var(--muted)]">No brands available yet.</p>
            </Card>
          </div>
        ) : null}

        {!brandsQuery.isLoading && brands.length && !filtered.length ? (
          <div className="mt-8">
            <Card>
              <p className="text-sm text-[var(--muted)]">
                No brands match “{debounced}”. Try a different search.
              </p>
            </Card>
          </div>
        ) : null}

        {pageBrands.length ? (
          <>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 md:mt-8 md:grid-cols-3 md:gap-5 lg:grid-cols-4">
              {pageBrands.map((b) => (
                <BrandCard key={b.id} brand={b} />
              ))}
            </div>

            {totalPages > 1 ? (
              <nav
                className="mt-8 flex items-center justify-center gap-1.5 md:mt-10"
                aria-label="Brand pages"
              >
                <button
                  type="button"
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage <= 1}
                  className="grid h-10 w-10 place-items-center rounded-full border border-[var(--border-soft)] bg-[var(--surface)] text-[var(--foreground)] transition-colors hover:border-red-300 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Previous page"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </button>

                {pageWindow(currentPage, totalPages).map((p, i) =>
                  p === "…" ? (
                    <span
                      key={`gap-${i}`}
                      className="grid h-10 w-8 place-items-center text-sm font-bold text-[var(--muted)]"
                      aria-hidden
                    >
                      …
                    </span>
                  ) : (
                    <button
                      key={p}
                      type="button"
                      onClick={() => goToPage(p)}
                      aria-current={p === currentPage ? "page" : undefined}
                      className={
                        p === currentPage
                          ? "grid h-10 min-w-10 place-items-center rounded-full bg-red-600 px-3 text-sm font-black text-white"
                          : "grid h-10 min-w-10 place-items-center rounded-full border border-[var(--border-soft)] bg-[var(--surface)] px-3 text-sm font-bold text-[var(--foreground)] transition-colors hover:border-red-300 hover:text-red-600"
                      }
                    >
                      {p}
                    </button>
                  ),
                )}

                <button
                  type="button"
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage >= totalPages}
                  className="grid h-10 w-10 place-items-center rounded-full border border-[var(--border-soft)] bg-[var(--surface)] text-[var(--foreground)] transition-colors hover:border-red-300 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Next page"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </button>
              </nav>
            ) : null}
          </>
        ) : null}
      </section>

      <SiteFooter />
    </AppShell>
  );
}

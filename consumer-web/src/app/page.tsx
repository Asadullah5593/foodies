"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { BrandCard } from "@/components/brand-card";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { AppShell, Button, Card, Loader } from "@/components/ui";
import { getTenantBrands } from "@/lib/api/consumer";
import { useEnterBrand } from "@/lib/hooks/use-enter-brand";

/** How many brands the homepage previews before offering "View all brands". */
const HOME_BRAND_LIMIT = 8;

const HOME_FEATURE_BLURBS: Array<{ icon: string; title: string; body: string; detail?: string }> = [
  {
    icon: "/Icons (2).svg",
    title: "Wide Variety",
    body: "Multiple cuisines under one roof",
  },
  {
    icon: "/Icons (3).svg",
    title: "Quality",
    body: "Fresh ingredients, great taste",
  },
  {
    icon: "/Icons (1).svg",
    title: "Best Experience",
    body: "Fast service and happy moments",
  },
];

export default function Home() {
  const enterBrand = useEnterBrand();

  const brandsQuery = useQuery({
    queryKey: ["tenant-brands"],
    queryFn: () => getTenantBrands(),
    // Avoid showing cached empty/error results after client-side navigation.
    refetchOnMount: "always",
    refetchOnReconnect: true,
    staleTime: 0,
  });

  const brands = useMemo(() => brandsQuery.data ?? [], [brandsQuery.data]);
  const homeBrands = useMemo(() => brands.slice(0, HOME_BRAND_LIMIT), [brands]);
  const hasMoreBrands = brands.length > HOME_BRAND_LIMIT;

  return (
    <AppShell>
      <motion.section initial={false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
        <SiteHeader />

        <section className="relative overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] shadow-sm md:min-h-[360px]">
          {/* Desktop: full-bleed background (unchanged) */}
          <div className="absolute inset-0 hidden md:block">
            <Image
              src="/Banner.jpg.jpeg"
              alt=""
              fill
              priority
              sizes="(max-width: 1280px) 100vw, 1280px"
              className="object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-white/50 via-white/40 to-white/10" />
          </div>

          {/* Mobile: text on solid surface — no overlap with food photo */}
          <div className="relative z-10 bg-[var(--surface)] px-4 pb-4 pt-6 md:bg-transparent md:px-10 md:py-14">
            <div className="max-w-xl">
              <div className="flex items-center gap-3">
                <span className="h-[2px] w-8 rounded-full bg-red-600 md:w-10" aria-hidden="true" />
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-red-600 md:text-xs">
                  Welcome to
                </p>
              </div>
              <h1 className="mt-3 text-3xl font-black leading-[0.92] tracking-tight text-[var(--foreground)] md:text-6xl">
                FOODIES
                <br />
                <span className="text-red-600">FOOD COURT</span>
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-[var(--muted)] md:mt-4 md:text-base">
                A world of flavors, under one roof. Choose your favorite brand and enjoy a delicious experience.
              </p>
              {/* Desktop: button stays under copy */}
              <div className="mt-5 hidden md:mt-7 md:block">
                <Button
                  type="button"
                  className="rounded-full bg-zinc-900 px-6 py-3 text-sm font-black uppercase tracking-wide text-white hover:bg-zinc-800"
                  onClick={() => document.getElementById("choose-brand")?.scrollIntoView({ behavior: "smooth" })}
                >
                  <span className="inline-flex items-center gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-full border border-white/20 bg-white/10">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="22"
                        height="22"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                        className="text-white"
                      >
                        <path d="M16.5 7.5 14.25 14.25 7.5 16.5l2.25-6.75z" />
                        <circle cx="12" cy="12" r="10" />
                      </svg>
                    </span>
                    Choose your brand
                  </span>
                </Button>
              </div>
            </div>
          </div>

          {/* Mobile: food image, then CTA below */}
          <div className="relative h-44 w-full shrink-0 overflow-hidden md:hidden">
            <Image
              src="/Banner.jpg.jpeg"
              alt=""
              fill
              sizes="100vw"
              className="object-cover object-center"
            />
            <div
              className="absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-[var(--surface)] to-transparent"
              aria-hidden
            />
          </div>

          <div className="bg-[var(--surface)] px-4 pb-6 pt-4 md:hidden">
            <Button
              type="button"
              className="w-full rounded-full bg-zinc-900 px-6 py-3.5 text-sm font-black uppercase tracking-wide text-white hover:bg-zinc-800"
              onClick={() => document.getElementById("choose-brand")?.scrollIntoView({ behavior: "smooth" })}
            >
              <span className="inline-flex items-center justify-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-full border border-white/20 bg-white/10">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="text-white"
                  >
                    <path d="M16.5 7.5 14.25 14.25 7.5 16.5l2.25-6.75z" />
                    <circle cx="12" cy="12" r="10" />
                  </svg>
                </span>
                Choose your brand
              </span>
            </Button>
          </div>
        </section>

        <section id="choose-brand" className="mt-8 md:mt-12">
          <div className="text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center md:h-14 md:w-14">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="54"
                height="54"
                viewBox="0 0 48 48"
                fill="none"
                aria-hidden="true"
              >
                {/* rays */}
                <path
                  d="M24 5v5M14.5 7.5l2.5 4.3M33.5 7.5 31 11.8M7.5 16l4.3 2.5M40.5 16 36.2 18.5"
                  stroke="#dc2626"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
                {/* cloche */}
                <path
                  d="M12 28c1.8-8.6 8.1-14 12-14s10.2 5.4 12 14"
                  stroke="#dc2626"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M9 30h30"
                  stroke="#dc2626"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                />
                <path
                  d="M14 34h20"
                  stroke="#dc2626"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                />
                <path
                  d="M24 12.2c1.3 0 2.3-1 2.3-2.3S25.3 7.6 24 7.6s-2.3 1-2.3 2.3 1 2.3 2.3 2.3Z"
                  fill="#dc2626"
                />
              </svg>
            </div>
            <p className="mt-3 text-xs font-black uppercase tracking-[0.24em] text-red-600">Choose your favorite</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-[var(--foreground)] md:text-4xl">BRAND</h2>
            <div className="mx-auto mt-2 h-[3px] w-10 rounded-full bg-red-600 md:w-12" aria-hidden="true" />
            <p className="mt-2 px-2 text-sm text-[var(--muted)] md:mt-3 md:px-0">
              Select a brand below to explore the menu and place your order
            </p>
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

          {homeBrands.length ? (
            <div className="mt-6 grid gap-4 sm:grid-cols-2 md:mt-10 md:grid-cols-3 md:gap-5 lg:grid-cols-4">
              {homeBrands.map((b) => (
                <BrandCard key={b.id} brand={b} />
              ))}
            </div>
          ) : null}

          <div className="mt-6 flex items-center justify-center md:mt-8">
            {hasMoreBrands ? (
              <Link
                href="/brands"
                className="inline-flex w-full max-w-sm items-center justify-center gap-3 rounded-full bg-zinc-900 px-6 py-3 text-sm font-black uppercase tracking-wide text-white transition-colors hover:bg-zinc-800 md:w-auto md:px-8"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/20 bg-white/10 md:h-11 md:w-11">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                View all {brands.length} brands
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.25"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="shrink-0"
                >
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </Link>
            ) : (
              <div className="inline-flex w-full max-w-sm items-center justify-center gap-3 rounded-full border border-[var(--border-soft)] bg-[var(--surface)] px-5 py-2.5 text-xs font-black tracking-wide text-[var(--muted)] md:w-auto md:px-6 md:py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--surface-2)] text-[var(--muted)] md:h-11 md:w-11">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                More brands coming soon
              </div>
            )}
          </div>
        </section>

        <section className="mt-8 overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] shadow-sm md:mt-14">
          {/* <div className="border-b border-[var(--border-soft)] px-6 py-5 md:px-10 md:py-7">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-red-600">Why Foodies?</p>
            <p className="mt-2 max-w-4xl text-sm leading-relaxed text-[var(--muted)] md:text-base">
              One destination for curated brands, dependable quality, and service that keeps pace with your day. Explore menus,
              compare favorites, and order with confidence — all from a food court experience built around you.
            </p>
          </div> */}

          <div className="grid gap-0 md:grid-cols-[minmax(0,2fr)_auto_minmax(0,1.25fr)]">
            <div className="grid grid-cols-3 gap-2 p-3 md:gap-0 md:p-0">
              {HOME_FEATURE_BLURBS.map((x) => (
                <div
                  key={x.title}
                  className="flex w-full flex-col items-center text-center md:min-h-[260px] md:justify-center md:px-8 md:py-10 lg:px-10 md:not-last:border-r md:not-last:border-[var(--border-soft)]"
                >
                  <div className="mx-auto grid h-12 w-12 shrink-0 place-items-center rounded-full border border-red-200 bg-white shadow-sm md:h-20 md:w-20">
                    <Image
                      src={x.icon}
                      alt=""
                      width={46}
                      height={46}
                      unoptimized
                      className="h-8 w-8 md:h-[46px] md:w-[46px]"
                    />
                  </div>
                  <div className="mt-2 w-full px-0.5 md:mt-3 md:max-w-md md:px-0">
                    <p className="text-[11px] font-black leading-tight text-[var(--foreground)] md:text-base">
                      {x.title}
                    </p>
                    <p className="mt-0.5 text-[10px] leading-snug text-[var(--muted)] md:mt-1 md:text-sm md:text-[var(--foreground)]">
                      {x.body}
                    </p>
                    {x.detail ? (
                      <p className="mt-2 hidden text-xs leading-relaxed text-[var(--muted)] md:block md:text-sm">
                        {x.detail}
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden w-px bg-[var(--border-soft)] md:block" aria-hidden="true" />

            <div className="relative min-h-[168px] overflow-hidden bg-rose-50 p-4 md:min-h-[280px] md:p-10 lg:p-12">
              <div className="relative z-10 max-w-lg pr-[38%] md:max-w-xl md:pr-[42%] lg:pr-[44%]">
                <p className="text-xl font-black leading-[0.95] tracking-tight text-[var(--foreground)] md:text-4xl">
                  CRAVING <span className="text-red-600">SOMETHING?</span>
                </p>
                <div className="mt-1.5 h-1 w-8 rounded-full bg-[var(--border-soft)] md:mt-3 md:w-10" aria-hidden="true" />
                <p className="mt-1.5 text-xs leading-snug text-[var(--muted)] md:mt-3 md:text-base md:leading-relaxed">
                  Good food is just a click away! Pick a brand, explore the menu, and place your order in minutes
                </p>
                <div className="mt-3 md:mt-5">
                  <Button
                    type="button"
                    className="rounded-full bg-zinc-900 px-5 py-2.5 text-xs font-black text-white hover:bg-zinc-800 md:px-7 md:py-3 md:text-sm"
                    onClick={() => (homeBrands[0] ? enterBrand(homeBrands[0]) : null)}
                    disabled={!homeBrands.length}
                  >
                    Order Now →
                  </Button>
                </div>
              </div>

              <div className="pointer-events-none absolute inset-y-0 right-0 w-[44%] md:w-[52%]">
                <div className="absolute inset-0 bg-gradient-to-l from-rose-50 via-rose-50/80 to-transparent md:via-rose-50/70" />
                <div className="relative h-full w-full">
                  <Image
                    src="/Banner_02.jpg.jpeg"
                    alt=""
                    fill
                    sizes="(max-width: 768px) 44vw, (max-width: 1536px) 42vw, 600px"
                    className="object-contain object-right object-bottom md:scale-[1.08]"
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        <SiteFooter />
      </motion.section>
    </AppShell>
  );
}

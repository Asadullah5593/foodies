"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { AppShell, Button, Card, Loader } from "@/components/ui";
import { getTenantBrands } from "@/lib/api/consumer";
import { toImageUrl } from "@/lib/api/client";
import type { Brand } from "@/lib/api/types";
import { useSessionStore } from "@/lib/store/session-store";

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
  const router = useRouter();
  const setBrandId = useSessionStore((s) => s.setBrandId);

  const brandsQuery = useQuery({
    queryKey: ["tenant-brands"],
    queryFn: () => getTenantBrands(),
    // Avoid showing cached empty/error results after client-side navigation.
    refetchOnMount: "always",
    refetchOnReconnect: true,
    staleTime: 0,
  });

  const brands = useMemo(() => brandsQuery.data ?? [], [brandsQuery.data]);
  const topBrands = useMemo(() => brands.slice(0, 3), [brands]);

  const enterBrand = (brand: Brand) => {
    setBrandId(brand.id);
    router.push("/menu");
  };

  return (
    <AppShell>
      <motion.section initial={false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
        <SiteHeader />

        <section className="relative overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] shadow-sm">
          <div className="absolute inset-0">
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

          <div className="relative z-10 px-6 py-10 md:px-10 md:py-14">
            <div className="max-w-xl">
              <div className="flex items-center gap-3">
                <span className="h-[2px] w-10 rounded-full bg-red-600" aria-hidden="true" />
                <p className="text-xs font-black uppercase tracking-[0.24em] text-red-600">Welcome to</p>
              </div>
              <h1 className="mt-3 text-4xl font-black leading-[0.92] tracking-tight text-[var(--foreground)] md:text-6xl">
                FOODIES
                <br />
                <span className="text-red-600">FOOD COURT</span>
              </h1>
              <p className="mt-4 text-sm text-[var(--muted)] md:text-base">
                A world of flavors, under one roof. Choose your favorite brand and enjoy a delicious experience.
              </p>
              <div className="mt-7">
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
        </section>

        <section id="choose-brand" className="mt-12">
          <div className="text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center">
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
            <h2 className="mt-2 text-4xl font-black tracking-tight text-[var(--foreground)]">BRAND</h2>
            <div className="mx-auto mt-2 h-[3px] w-12 rounded-full bg-red-600" aria-hidden="true" />
            <p className="mt-3 text-sm text-[var(--muted)]">Select a brand below to explore the menu and place your order</p>
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

          {topBrands.length ? (
            <div className="mt-10 grid gap-5 md:grid-cols-3">
              {topBrands.map((b) => (
                <div
                  key={b.id}
                  className="overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] shadow-sm"
                >
                  <div className="relative h-44 bg-[var(--surface-2)]">
                    <Image
                      src="/Banner_02.jpg.jpeg"
                      alt=""
                      fill
                      sizes="(max-width: 768px) 100vw, 33vw"
                      className="object-cover opacity-90"
                    />
                  </div>
                  <div className="relative -mt-10 px-6 pb-6">
                    <div className="relative mx-auto h-40 w-40 rounded-full border border-[var(--border-soft)] bg-white p-3 shadow-sm">
                      {b.logo_url ? (
                        <Image
                          src={toImageUrl(b.logo_url)}
                          alt={b.name}
                          fill
                          unoptimized
                          sizes="160px"
                          className="object-contain p-1"
                        />
                      ) : (
                        <span className="flex h-full items-center justify-center text-3xl font-black text-red-600">
                          {(b.name || "?").slice(0, 1)}
                        </span>
                      )}
                    </div>
                    <h3 className="mt-4 text-center text-lg font-black text-[var(--foreground)]">{b.name}</h3>
                    <button
                      type="button"
                      onClick={() => enterBrand(b)}
                      className="mx-auto mt-4 flex items-center justify-center gap-2.5 text-sm font-black text-red-600 hover:underline"
                    >
                      View Menu
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="22"
                        height="22"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.25"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                        className="shrink-0 text-red-600"
                      >
                        <path d="M5 12h14M13 6l6 6-6 6" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-8 flex items-center justify-center">
            <div className="inline-flex items-center gap-3 rounded-full border border-[var(--border-soft)] bg-[var(--surface)] px-6 py-3 text-xs font-black tracking-wide text-[var(--muted)]">
              <span className="grid h-11 w-11 place-items-center rounded-lg bg-[var(--surface-2)] text-[var(--muted)]">
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
          </div>
        </section>

        <section className="mt-14 overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] shadow-sm">
          {/* <div className="border-b border-[var(--border-soft)] px-6 py-5 md:px-10 md:py-7">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-red-600">Why Foodies?</p>
            <p className="mt-2 max-w-4xl text-sm leading-relaxed text-[var(--muted)] md:text-base">
              One destination for curated brands, dependable quality, and service that keeps pace with your day. Explore menus,
              compare favorites, and order with confidence — all from a food court experience built around you.
            </p>
          </div> */}

          <div className="grid gap-0 md:grid-cols-[minmax(0,2fr)_auto_minmax(0,1.25fr)]">
            <div className="grid gap-6 p-6 sm:grid-cols-3 sm:gap-4 md:gap-0 md:p-0">
              {HOME_FEATURE_BLURBS.map((x) => (
                <div
                  key={x.title}
                  className="flex w-full flex-col items-center text-center md:min-h-[260px] md:justify-center md:px-8 md:py-10 lg:px-10 md:not-last:border-r md:not-last:border-[var(--border-soft)]"
                >
                  <div className="mx-auto grid h-20 w-20 shrink-0 place-items-center rounded-full border border-red-200 bg-white shadow-sm">
                    <Image src={x.icon} alt="" width={46} height={46} unoptimized />
                  </div>
                  <div className="mt-3 w-full max-w-md px-1 sm:px-0">
                    <p className="text-sm font-black text-[var(--foreground)] md:text-base">{x.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-[var(--foreground)]">{x.body}</p>
                    {x.detail ? (
                      <p className="mt-2 text-xs leading-relaxed text-[var(--muted)] md:text-sm">{x.detail}</p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden w-px bg-[var(--border-soft)] md:block" aria-hidden="true" />

            <div className="relative min-h-[240px] overflow-hidden bg-rose-50 p-6 md:min-h-[280px] md:p-10 lg:p-12">
              <div className="relative z-10 max-w-lg pr-0 md:max-w-xl md:pr-[42%] lg:pr-[44%]">
                <p className="text-3xl font-black leading-[0.95] tracking-tight text-[var(--foreground)] md:text-4xl">
                  CRAVING <span className="text-red-600">SOMETHING?</span>
                </p>
                <div className="mt-3 h-1 w-10 rounded-full bg-[var(--border-soft)]" aria-hidden="true" />
                <p className="mt-3 text-sm leading-relaxed text-[var(--muted)] md:text-base">
                  Good food is just a click away! Pick a brand, explore the menu, and place your order in minutes 
                  {/* — whether
                  you&apos;re dining in or grabbing something on the go. */}
                </p>
                {/* <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted)] md:text-sm">
                  New brands join regularly — check back often for fresh menus and limited-time favorites.
                </p> */}
                <div className="mt-5">
                  <Button
                    type="button"
                    className="rounded-full bg-zinc-900 px-7 py-3 text-sm font-black text-white hover:bg-zinc-800"
                    onClick={() => (topBrands[0] ? enterBrand(topBrands[0]) : null)}
                    disabled={!topBrands.length}
                  >
                    Order Now →
                  </Button>
                </div>
              </div>

              <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[52%] md:block">
                <div className="absolute inset-0 bg-gradient-to-l from-rose-50 via-rose-50/70 to-transparent" />
                <div className="relative h-full w-full">
                  <Image
                    src="/Banner_02.jpg.jpeg"
                    alt=""
                    fill
                    sizes="(max-width: 768px) 100vw, (max-width: 1536px) 42vw, 600px"
                    className="object-contain object-right scale-[1.08]"
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

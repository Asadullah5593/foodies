"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { AppShell, Card } from "@/components/ui";
import { getTenantBrands, getTenantMenuByBrand } from "@/lib/api/consumer";
import type { MenuItem } from "@/lib/api/types";
import { toImageUrl } from "@/lib/api/client";
import { MenuItemImage } from "@/components/menu-item-image";
import { menuImageUrl } from "@/lib/menu-image-url";
import { useSessionStore } from "@/lib/store/session-store";
import { orderRedirectConfig } from "@/lib/config/order-redirect";
import clsx from "clsx";

/** Design tokens — match FOODXCOURT reference (KFC-adjacent red, light greys). */
const R = {
  brand: "#E4002B",
  page: "#F9F9F9",
  sidebar: "#F5F5F5",
  line: "#EBEBEB",
  cardBorder: "#E8E8E8",
  text: "#000000",
  muted: "#666666",
  iconIdle: "#757575",
} as const;

const ALL_NAV_ID = "all";
const ITEMS_PER_PAGE = 9;
const MotionLink = motion(Link);

const MENU_ITEM_PLACEHOLDER = (label: string) => {
  const safe = (label || "Food").replace(/[<>&"]/g, "");
  const words = safe.split(/\s+/).filter(Boolean);
  let line1 = "";
  let line2 = "";
  if (words.length <= 1) {
    const text = safe;
    if (text.length <= 14) {
      line1 = text;
    } else if (text.length <= 22) {
      line1 = text.slice(0, 14);
      line2 = text.slice(14, 22);
    } else {
      line1 = text.slice(0, 16);
      line2 = text.slice(16, 32);
    }
  } else {
    const mid = Math.ceil(words.length / 2);
    line1 = words.slice(0, mid).join(" ");
    line2 = words.slice(mid).join(" ");
  }

  const maxLen = Math.max(line1.length, line2.length);
  const fontSize = maxLen > 22 ? 52 : maxLen > 16 ? 62 : 72;
  const lineHeight = Math.round(fontSize * 1.1);
  const y1 = 410;
  const y2 = y1 + lineHeight;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="750" viewBox="0 0 1200 750">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fecaca" stop-opacity="0.9" />
      <stop offset="0.55" stop-color="#f4f4f5" stop-opacity="1" />
      <stop offset="1" stop-color="#e4e4e7" stop-opacity="1" />
    </linearGradient>
  </defs>
  <rect width="1200" height="750" fill="url(#g)"/>
  <g opacity="0.35">
    <circle cx="220" cy="220" r="160" fill="${R.brand}"/>
    <circle cx="980" cy="520" r="220" fill="${R.brand}"/>
  </g>
  <text x="600" y="${y1}" text-anchor="middle" font-family="ui-sans-serif, system-ui" font-size="${fontSize}" font-weight="900" fill="#18181b" letter-spacing="1">${line1}</text>
  ${
    line2
      ? `<text x="600" y="${y2}" text-anchor="middle" font-family="ui-sans-serif, system-ui" font-size="${fontSize}" font-weight="900" fill="#18181b" letter-spacing="1">${line2}</text>`
      : ""
  }
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

function categorySectionId(index: number, raw: string) {
  const base = (raw.trim() || "menu").toLowerCase().replace(/\s+/g, "-");
  const safe = base.replace(/[^a-z0-9-]/gi, "") || "menu";
  return `menu-section-${index}-${safe}`;
}

type NavIconProps = { className?: string };

function MenuGridSkeleton({ count = 9 }: { count?: number }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={`sk-${i}`}
          className="animate-pulse overflow-hidden rounded-2xl border bg-white"
          style={{ borderColor: "rgba(0,0,0,0.08)" }}
        >
          <div className="aspect-[4/3] bg-neutral-100" />
          <div className="space-y-2 p-4">
            <div className="h-4 w-3/4 rounded bg-neutral-100" />
            <div className="h-3 w-full rounded bg-neutral-100" />
            <div className="h-3 w-24 rounded bg-neutral-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

function IconGrid({ className }: NavIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z" strokeLinejoin="round" />
    </svg>
  );
}

function IconStar({ className }: NavIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M12 3.5 14.2 9l5.8.5-4.4 3.8 1.4 5.7L12 16.9 6.9 19l1.4-5.7L4 9.5l5.8-.5L12 3.5z" strokeLinejoin="round" />
    </svg>
  );
}

function IconBucket({ className }: NavIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M7 10h10l-1 10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2L7 10z" strokeLinejoin="round" />
      <path d="M9 10V8a3 3 0 0 1 6 0v2" strokeLinecap="round" />
      <path d="M6 10h12" strokeLinecap="round" />
    </svg>
  );
}

function IconChicken({ className }: NavIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path
        d="M12 20c-2.5-1.5-4-4-4-7 0-3 2-6 4-8 2 2 4 5 4 8 0 3-1.5 5.5-4 7z"
        strokeLinejoin="round"
      />
      <path d="M12 13v-3M10 11h4" strokeLinecap="round" />
    </svg>
  );
}

function IconBurger({ className }: NavIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M5 12h14M5 8h14a1 1 0 0 0 1-1V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v1a1 1 0 0 0 1 1z" strokeLinejoin="round" />
      <path d="M5 16h14v1a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-1z" strokeLinejoin="round" />
      <path d="M5 12v4M19 12v4" strokeLinecap="round" />
    </svg>
  );
}

function IconFries({ className }: NavIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M8 20V10l2-6 2 6v10M12 20V8l2-5 2 5v12M16 20V11l2-4 2 4v9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconDrink({ className }: NavIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M8 4h8l-1 16a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2L8 4z" strokeLinejoin="round" />
      <path d="M7 8h10M10 4v4M14 4v4" strokeLinecap="round" />
    </svg>
  );
}

function IconCake({ className }: NavIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M4 16h16v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3z" strokeLinejoin="round" />
      <path d="M8 16V9a4 4 0 0 1 8 0v7" strokeLinejoin="round" />
      <path d="M4 12c2 2 4 2 6 0s4-2 6 0 4 2 6 0" strokeLinecap="round" />
    </svg>
  );
}

function IconChevronDown({ className }: NavIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconCheckBadge({ className }: NavIconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" fill={R.brand} />
      <path
        d="M8.5 12.2 10.8 14.5 15.5 9.5"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function categoryIconForLabel(label: string) {
  const l = label.toLowerCase();
  if (l.includes("best")) return IconStar;
  if (l.includes("bucket")) return IconBucket;
  if (l.includes("chicken") || l.includes("meal")) return IconChicken;
  if (l.includes("burger")) return IconBurger;
  if (l.includes("snack") || l.includes("fries") || l.includes("side")) return IconFries;
  if (l.includes("beverage") || l.includes("drink")) return IconDrink;
  if (l.includes("dessert") || l.includes("cake") || l.includes("sweet")) return IconCake;
  return IconGrid;
}

export default function MenuPage() {
  const selectedBrandId = useSessionStore((s) => s.selectedBrandId);
  const setBrandId = useSessionStore((s) => s.setBrandId);

  const [activeNavId, setActiveNavId] = useState<string>(ALL_NAV_ID);
  const [visibleCount, setVisibleCount] = useState<number>(ITEMS_PER_PAGE);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const switchTimerRef = useRef<number | null>(null);

  const brandsQuery = useQuery({
    queryKey: ["tenant-brands"],
    queryFn: () => getTenantBrands(),
    enabled: true,
    // Avoid showing cached empty/error results after client-side navigation.
    refetchOnMount: "always",
    refetchOnReconnect: true,
    staleTime: 0,
  });

  const menuQuery = useQuery({
    queryKey: ["tenant-menu", selectedBrandId],
    queryFn: () => getTenantMenuByBrand(selectedBrandId!),
    enabled: Boolean(selectedBrandId),
  });

  const beginSwitch = useCallback(() => {
    setIsSwitching(true);
    if (switchTimerRef.current != null) window.clearTimeout(switchTimerRef.current);
    // Hard fallback so we never get stuck showing skeleton.
    switchTimerRef.current = window.setTimeout(() => setIsSwitching(false), 900);
  }, []);

  const endSwitchSoon = useCallback(() => {
    if (switchTimerRef.current != null) window.clearTimeout(switchTimerRef.current);
    switchTimerRef.current = window.setTimeout(() => setIsSwitching(false), 220);
  }, []);

  useEffect(() => {
    // When the brand menu finishes fetching, stop showing the "switching" skeleton.
    if (!menuQuery.isFetching) {
      const t = window.setTimeout(() => setIsSwitching(false), 180);
      return () => window.clearTimeout(t);
    }
    return;
  }, [menuQuery.isFetching]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "light");
  }, []);

  useEffect(() => {
    const brands = brandsQuery.data;
    if (!brands?.length) return;
    const current = selectedBrandId;
    if (current != null && brands.some((b) => b.id === current)) return;
    setBrandId(brands[0]!.id);
  }, [brandsQuery.data, selectedBrandId, setBrandId]);

  const menuList = useMemo(() => menuQuery.data ?? [], [menuQuery.data]);

  const categoryBlocks = useMemo(() => {
    const blocks: { id: string; label: string; items: MenuItem[] }[] = [];
    const indexByLabel = new Map<string, number>();
    for (const item of menuList) {
      const label = (item.category || "Other").trim() || "Other";
      let idx = indexByLabel.get(label);
      if (idx === undefined) {
        const id = categorySectionId(blocks.length, label);
        idx = blocks.length;
        indexByLabel.set(label, idx);
        blocks.push({ id, label, items: [] });
      }
      blocks[idx]!.items.push(item);
    }
    return blocks;
  }, [menuList]);

  const navRows = useMemo(() => {
    const rows: { id: string; label: string; Icon: (p: NavIconProps) => ReactElement }[] = [
      { id: ALL_NAV_ID, label: "All", Icon: IconGrid },
    ];
    for (const c of categoryBlocks) {
      const Icon = categoryIconForLabel(c.label);
      rows.push({ id: c.id, label: c.label, Icon });
    }
    return rows;
  }, [categoryBlocks]);

  const selectCategory = useCallback(
    (id: string) => {
      // Ensure the skeleton renders for at least one frame before the grid swaps.
      beginSwitch();
      window.requestAnimationFrame(() => {
        setActiveNavId(id);
        setVisibleCount(ITEMS_PER_PAGE);
        endSwitchSoon();
      });
    },
    [beginSwitch, endSwitchSoon],
  );

  const orderInfoHref = "/order-info";
  const brandsOnBranch = brandsQuery.data ?? [];
  /** Few brands: equal-width row fills the container; many brands: horizontal scroll with sensible min width. */
  const brandRowScroll = brandsOnBranch.length > 5;

  const locationSub = null;

  const renderNavButton = (compact: boolean) =>
    navRows.map((row) => {
      const active = activeNavId === row.id;
      const Icon = row.Icon;
      if (compact) {
        return (
          <button
            key={row.id}
            type="button"
            onClick={() => selectCategory(row.id)}
            className={clsx(
              "flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-left text-xs font-semibold transition",
              active
                ? "bg-white shadow-sm"
                : "border-transparent bg-white/80 hover:bg-white",
            )}
            style={
              active
                ? { borderColor: R.brand, color: R.brand }
                : { borderColor: R.cardBorder, color: R.muted }
            }
          >
            <Icon className="h-4 w-4 shrink-0 text-current" />
            <span className="max-w-[140px] truncate">{row.label}</span>
          </button>
        );
      }
      return (
        <button
          key={row.id}
          type="button"
          onClick={() => selectCategory(row.id)}
          className={clsx(
            "relative flex w-full items-center gap-3 py-3 pl-5 pr-3 text-left text-[15px] font-semibold transition",
          )}
          style={{
            color: active ? R.brand : R.muted,
            borderLeft: active ? `3px solid ${R.brand}` : "3px solid transparent",
          }}
        >
          <Icon className="h-[22px] w-[22px] shrink-0 text-current" />
          <span className="truncate">{row.label}</span>
        </button>
      );
    });

  const sidebarNav = (
    <nav className="flex flex-col pt-4" aria-label="Menu categories">
      {renderNavButton(false)}
    </nav>
  );

  const sidebarSkeleton = (
    <div className="px-6 py-4">
      <div className="animate-pulse space-y-3">
        {Array.from({ length: 11 }).map((_, i) => (
          <div key={`nav-sk-${i}`} className="flex items-center gap-3">
            <div className="h-5 w-5 rounded-md bg-neutral-200" />
            <div className="h-3 w-40 rounded bg-neutral-200" />
          </div>
        ))}
      </div>
    </div>
  );

  const mobileCategoryStrip = (
    <nav
      className="mb-6 mt-5 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden"
      aria-label="Menu categories"
    >
      {menuQuery.isLoading || menuQuery.isFetching || isSwitching ? (
        <div className="flex gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={`mobile-nav-sk-${i}`}
              className="h-9 w-28 animate-pulse rounded-full bg-white/90"
              style={{ border: `1px solid ${R.line}` }}
            />
          ))}
        </div>
      ) : (
        renderNavButton(true)
      )}
    </nav>
  );

  // Branch selection is no longer required (tenant menu browsing).

  const activeItems = useMemo(() => {
    if (activeNavId === ALL_NAV_ID) return menuList;
    const block = categoryBlocks.find((b) => b.id === activeNavId);
    return block?.items ?? [];
  }, [activeNavId, categoryBlocks, menuList]);

  const visibleItems = useMemo(
    () => activeItems.slice(0, Math.max(0, visibleCount)),
    [activeItems, visibleCount],
  );

  const canLoadMore = visibleItems.length < activeItems.length;

  const loadMore = useCallback(() => {
    if (!canLoadMore || isLoadingMore) return;
    setIsLoadingMore(true);
    window.setTimeout(() => {
      setVisibleCount((c) => c + ITEMS_PER_PAGE);
      setIsLoadingMore(false);
    }, 350);
  }, [canLoadMore, isLoadingMore]);

  const gridKey = `${selectedBrandId ?? "none"}-${activeNavId}`;
  const listStagger = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.045, delayChildren: 0.04 } },
  } as const;
  const itemIn = {
    hidden: { opacity: 0, scale: 0.992 },
    show: { opacity: 1, scale: 1, transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] } },
  } as const;

  return (
    <AppShell>
      <div className="font-[family-name:var(--font-geist-sans),system-ui,sans-serif]" style={{ color: R.text }}>
        <SiteHeader />

        <section
          className="rounded-2xl border bg-white shadow-sm"
          style={{ borderColor: R.line, backgroundColor: R.page }}
        >
          <div className="flex min-h-0">
            <aside
              className="hidden w-[280px] shrink-0 border-r lg:block"
              style={{ backgroundColor: R.sidebar, borderColor: R.line }}
            >
              <div className="sticky top-6 flex max-h-[calc(100vh-3rem)] flex-col self-start">
                <div className="px-6 pt-6">
                  <p className="text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: R.brand }}>
                    Categories
                  </p>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto pb-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {menuQuery.isLoading || menuQuery.isFetching || isSwitching ? sidebarSkeleton : sidebarNav}
                </div>
              </div>
            </aside>

            <div className="min-w-0 flex-1 px-3 py-5 sm:px-8 sm:py-9 lg:px-10 lg:py-10">
              <div
                className={clsx(
                  "mt-1 flex w-full gap-3 pb-1",
                  brandRowScroll &&
                    "max-lg:overflow-x-auto max-lg:pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
                  brandRowScroll
                    ? "lg:gap-5 lg:overflow-x-auto lg:pb-2 sm:lg:gap-6"
                    : "lg:gap-5 lg:overflow-visible lg:pb-0 sm:lg:gap-6",
                )}
              >
              {brandsOnBranch.map((b) => {
                const selected = b.id === selectedBrandId;
                return (
                  <motion.button
                    key={b.id}
                    type="button"
                    aria-label={b.name}
                    onClick={() => {
                      // Smooth brand switch: immediate skeleton, then fetch, then fade to content.
                      beginSwitch();
                      setBrandId(b.id);
                      setActiveNavId(ALL_NAV_ID);
                      setVisibleCount(ITEMS_PER_PAGE);
                    }}
                    className={clsx(
                      "relative flex rounded-2xl text-left transition will-change-transform",
                      brandRowScroll
                        ? "max-lg:w-[7.25rem] max-lg:shrink-0 max-lg:flex-col max-lg:items-center max-lg:justify-center max-lg:gap-2 max-lg:px-2.5 max-lg:py-3"
                        : "max-lg:min-w-0 max-lg:flex-1 max-lg:flex-col max-lg:items-center max-lg:justify-center max-lg:gap-2.5 max-lg:px-3 max-lg:py-4",
                      "lg:min-h-[118px] lg:items-center lg:gap-5 lg:px-8 lg:py-6",
                      brandRowScroll
                        ? "lg:w-[min(100%,28rem)] lg:shrink-0 sm:lg:w-[29rem]"
                        : "lg:min-w-0 lg:flex-1",
                    )}
                    style={{
                      borderWidth: selected ? 2 : 1,
                      borderStyle: "solid",
                      borderColor: selected ? R.brand : R.line,
                      boxShadow: selected
                        ? "0 10px 30px rgba(228, 0, 43, 0.16)"
                        : "0 8px 22px rgba(0,0,0,0.08)",
                      background: selected
                        ? "linear-gradient(180deg, rgba(228,0,43,0.06), rgba(255,255,255,0.96))"
                        : "linear-gradient(180deg, #ffffff, #fafafa)",
                    }}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                  >
                    <div className="relative shrink-0">
                      {selected ? (
                        <IconCheckBadge className="absolute -right-1 -top-1 z-10 h-5 w-5 lg:-right-0.5 lg:-top-0.5 lg:h-7 lg:w-7" />
                      ) : null}
                      <div
                        className={clsx(
                          "flex items-center justify-center overflow-hidden rounded-full lg:h-[84px] lg:w-[84px]",
                          brandRowScroll ? "h-14 w-14" : "h-16 w-16",
                        )}
                        style={{
                          backgroundColor: "#FFFFFF",
                          border: `1px solid ${selected ? R.brand : R.cardBorder}`,
                        }}
                      >
                        {b.logo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={toImageUrl(b.logo_url)}
                            alt=""
                            className="h-full w-full object-contain p-1"
                          />
                        ) : (
                          <span className="text-xs font-black lg:text-sm" style={{ color: R.muted }}>
                            {(b.name || "?").slice(0, 2).toUpperCase()}
                          </span>
                        )}
                      </div>
                    </div>
                    <span
                      className={clsx(
                        "line-clamp-2 w-full font-black leading-tight",
                        brandRowScroll ? "max-lg:text-[10px]" : "max-lg:text-[11px]",
                        "max-lg:text-center",
                        "lg:pr-3 lg:text-left lg:text-[18px] sm:lg:text-[20px]",
                      )}
                      style={{ color: R.text }}
                    >
                      {b.name}
                    </span>
                  </motion.button>
                );
              })}
            </div>

              {!selectedBrandId ? (
                <Card className="mt-8">
                  <p className="text-sm text-[var(--muted)]">Choose a brand to load its menu.</p>
                </Card>
              ) : null}

              {mobileCategoryStrip}

              {selectedBrandId && menuQuery.isLoading ? (
                <div className="mt-10">
                  <MenuGridSkeleton count={9} />
                </div>
              ) : null}

              {selectedBrandId && !menuQuery.isLoading ? (
                <div className="mt-10">
                  <AnimatePresence initial={false}>
                    {menuQuery.isFetching || isSwitching ? (
                      <motion.div
                        key="grid-skeleton"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.16, ease: "easeInOut" }}
                      >
                        <MenuGridSkeleton count={9} />
                      </motion.div>
                    ) : (
                      <motion.div
                        key={gridKey}
                        variants={listStagger}
                        initial="hidden"
                        animate="show"
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                        className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
                      >
                        {visibleItems.map((item) => (
                          <MotionLink
                            key={item.id}
                            href={`/menu/${item.id}`}
                            variants={itemIn}
                            className="group overflow-hidden rounded-2xl border transition will-change-transform"
                            style={{
                              borderColor: "rgba(0,0,0,0.08)",
                              background: "linear-gradient(180deg, rgba(255,255,255,0.96), rgba(244,244,245,0.95))",
                              boxShadow: "0 10px 30px rgba(0,0,0,0.06)",
                            }}
                            whileHover={{ scale: 1.01 }}
                          >
                            <div className="relative aspect-[4/3] w-full overflow-hidden bg-neutral-100">
                              <MenuItemImage
                                src={
                                  item.image_url
                                    ? menuImageUrl(toImageUrl(item.image_url), "display")
                                    : MENU_ITEM_PLACEHOLDER(item.name)
                                }
                                fallbackSrc={
                                  item.image_url ? toImageUrl(item.image_url) : undefined
                                }
                                alt={item.name}
                                fill
                                loading="lazy"
                                className={
                                  item.image_url
                                    ? "object-cover transition duration-300 group-hover:scale-[1.03]"
                                    : "object-contain"
                                }
                                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 400px"
                              />
                              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/6 via-transparent to-transparent opacity-0 transition group-hover:opacity-100" />
                            </div>
                            <div className="space-y-1.5 p-4">
                              <h4
                                className="line-clamp-2 text-[15px] font-bold leading-snug"
                                style={{ color: R.text }}
                              >
                                {item.name}
                              </h4>
                              <p className="line-clamp-2 text-[12px] leading-relaxed" style={{ color: R.muted }}>
                                {item.description?.trim() || "\u00a0"}
                              </p>
                              <p className="pt-1 text-[14px] font-black" style={{ color: R.brand }}>
                                Rs. {item.price}
                              </p>
                            </div>
                          </MotionLink>
                        ))}

                        {isLoadingMore
                          ? Array.from({ length: 3 }).map((_, i) => (
                              <motion.div
                                key={`more-sk-${i}`}
                                variants={itemIn}
                                className="animate-pulse overflow-hidden rounded-2xl border bg-white"
                                style={{ borderColor: "rgba(0,0,0,0.08)" }}
                              >
                                <div className="aspect-[4/3] bg-neutral-100" />
                                <div className="space-y-2 p-4">
                                  <div className="h-4 w-3/4 rounded bg-neutral-100" />
                                  <div className="h-3 w-full rounded bg-neutral-100" />
                                  <div className="h-3 w-24 rounded bg-neutral-100" />
                                </div>
                              </motion.div>
                            ))
                          : null}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className="mt-10 flex justify-center">
                    {canLoadMore ? (
                      <button
                        type="button"
                        onClick={loadMore}
                        className="inline-flex items-center gap-2 rounded-full border bg-white px-6 py-3 text-sm font-semibold transition hover:bg-neutral-50 disabled:opacity-60"
                        style={{ borderColor: R.line, color: R.text }}
                        disabled={isLoadingMore}
                      >
                        View more items
                        <IconChevronDown className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <p className="mt-10 text-center text-[11px]" style={{ color: R.muted }}>
                <Link
                  href={orderInfoHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  prefetch={false}
                  className="font-semibold hover:underline"
                  style={{ color: R.brand }}
                >
                  {orderRedirectConfig.ctaLabel}
                </Link>
                {locationSub ? (
                  <>
                    <span style={{ color: R.line }}> · </span>
                    <span>{locationSub}</span>
                  </>
                ) : null}
              </p>
            </div>
          </div>
        </section>

        <SiteFooter />
      </div>
    </AppShell>
  );
}

"use client";

import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { searchTenantMenu } from "@/lib/api/consumer";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { useSessionStore } from "@/lib/store/session-store";
import { toMenuImageUrl } from "@/lib/menu-image-url";
import { toImageUrl } from "@/lib/api/client";
import type { MenuSearchResult } from "@/lib/api/types";

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3-3" strokeLinecap="round" />
    </svg>
  );
}

function OrderNowIcon({ size = "md" }: { size?: "sm" | "md" }) {
  const dim = size === "sm" ? "h-4 w-4" : "h-[1.125rem] w-[1.125rem]";

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/shopping-bag.png"
      alt=""
      width={size === "sm" ? 16 : 18}
      height={size === "sm" ? 16 : 18}
      className={clsx("block shrink-0 object-contain brightness-0 invert", dim)}
      aria-hidden
    />
  );
}

function NavDivider() {
  return (
    <span className="text-zinc-300" aria-hidden>
      |
    </span>
  );
}

const orderNowLinkClass =
  "inline-flex items-center gap-2 rounded-lg bg-red-600 font-bold leading-none !text-white shadow-sm transition-colors hover:bg-red-700 hover:!text-white";

/** Debounced, suggestion-rich menu search used in the header. */
function HeaderSearch({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter();
  const setBrandId = useSessionStore((s) => s.setBrandId);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const debounced = useDebouncedValue(query, 250);
  const trimmed = debounced.trim();
  const enabled = trimmed.length >= 2;

  const { data, isFetching } = useQuery({
    queryKey: ["menu-search", trimmed],
    queryFn: () => searchTenantMenu(trimmed, 8),
    enabled,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const suggestions = useMemo<MenuSearchResult[]>(
    () => (enabled ? (data ?? []) : []),
    [enabled, data],
  );

  // Reset the highlighted row whenever the (debounced) query changes. Done
  // during render (not in an effect) per the react-hooks set-state-in-effect rule.
  const [prevTrimmed, setPrevTrimmed] = useState(trimmed);
  if (prevTrimmed !== trimmed) {
    setPrevTrimmed(trimmed);
    setActiveIndex(-1);
  }

  // Close the panel on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const goToAllResults = (raw: string) => {
    const q = raw.trim();
    // The results page is scoped to the selected brand, so land on the brand
    // of the best (tenant-wide) match — otherwise the page could be empty.
    if (q && suggestions[0]?.brand_id != null) {
      setBrandId(suggestions[0].brand_id);
    }
    router.push(q ? `/menu?search=${encodeURIComponent(q)}` : "/menu");
    setOpen(false);
    onNavigate?.();
  };

  const goToItem = (item: MenuSearchResult) => {
    // The item detail page resolves the item via the selected brand, so make
    // sure the suggestion's brand is active before navigating.
    if (item.brand_id != null) setBrandId(item.brand_id);
    router.push(`/menu/${item.id}`);
    setOpen(false);
    setQuery("");
    onNavigate?.();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Only act on the highlighted row while the panel is actually visible
    // (Escape / outside-click leave activeIndex set but hide the panel).
    if (open && enabled && activeIndex >= 0 && activeIndex < suggestions.length) {
      goToItem(suggestions[activeIndex]!);
    } else {
      goToAllResults(query);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      if (!suggestions.length) return;
      event.preventDefault();
      setOpen(true);
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (event.key === "ArrowUp") {
      if (!suggestions.length) return;
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (event.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  const showPanel = open && enabled;

  return (
    <div ref={containerRef} className="relative w-full md:min-w-0 md:flex-1">
      <form onSubmit={handleSubmit}>
        <label htmlFor="site-header-search" className="sr-only">
          Search the menu
        </label>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            id="site-header-search"
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            role="combobox"
            aria-expanded={showPanel}
            aria-controls="site-header-search-listbox"
            aria-autocomplete="list"
            placeholder="Search for dishes, cuisines..."
            className="w-full rounded-full border border-[var(--border-soft)] bg-[var(--surface)] py-2.5 pl-11 pr-10 text-sm text-[var(--foreground)] placeholder:text-zinc-400 outline-none transition-shadow focus:border-red-300 focus:ring-2 focus:ring-red-100"
          />
          {isFetching && enabled && (
            <span
              className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-zinc-300 border-t-red-600"
              aria-hidden
            />
          )}
        </div>
      </form>

      {showPanel && (
        <div
          id="site-header-search-listbox"
          role="listbox"
          className="absolute left-0 right-0 z-[100] mt-2 overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] shadow-xl"
        >
          {suggestions.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-zinc-500">
              {isFetching ? "Searching…" : `No matches for “${trimmed}”`}
            </div>
          ) : (
            <ul className="max-h-[22rem] overflow-y-auto py-1">
              {suggestions.map((item, idx) => {
                const thumb = toMenuImageUrl(item.image_url, toImageUrl, "thumb");
                const active = idx === activeIndex;
                return (
                  <li key={item.id} role="option" aria-selected={active}>
                    <button
                      type="button"
                      onMouseEnter={() => setActiveIndex(idx)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => goToItem(item)}
                      className={clsx(
                        "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors",
                        active ? "bg-red-50" : "hover:bg-zinc-50",
                      )}
                    >
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-zinc-100">
                        {thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                        ) : (
                          <SearchIcon className="h-4 w-4 text-zinc-300" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-[var(--foreground)]">
                          {item.name}
                        </span>
                        <span className="block truncate text-xs text-zinc-500">
                          {[item.brand_name, item.category].filter(Boolean).join(" · ") || "Menu item"}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-bold text-red-600">Rs. {item.price}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => goToAllResults(query)}
            className="flex w-full items-center justify-between border-t border-[var(--border-soft)] px-4 py-2.5 text-left text-sm font-semibold text-red-600 hover:bg-red-50"
          >
            <span className="truncate">See all results for “{trimmed}”</span>
            <span aria-hidden>→</span>
          </button>
        </div>
      )}
    </div>
  );
}

export function SiteHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);

  const closeMobile = () => setMobileOpen(false);

  // No overflow-hidden on <header>: it would clip the search suggestions panel
  // that drops below it. The red bar rounds its own top corners instead.
  return (
    <header className="relative mb-4 rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] shadow-sm md:mb-6">
      <div className="h-1 rounded-t-2xl bg-red-600" aria-hidden />

      <div className="px-4 py-3 md:px-6 md:py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-5 lg:gap-6">
          <div className="flex items-center justify-between gap-3 md:shrink-0">
            <Link
              href="/"
              className="flex min-w-0 items-center gap-3 rounded-lg outline-offset-2 hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-600"
              onClick={closeMobile}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/foodies-logo.png"
                alt="Foodies"
                className="h-10 w-10 shrink-0 rounded-full object-cover sm:h-11 sm:w-11"
              />
              <div className="min-w-0 leading-tight">
                <p className="truncate text-base font-black tracking-wide text-[var(--foreground)] sm:text-lg">
                  FOODIES
                </p>
                <p className="truncate text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--muted)] sm:text-xs">
                  Food Court
                </p>
              </div>
            </Link>

            <div className="flex shrink-0 items-center gap-2 md:hidden">
              <Link
                href="/order-info"
                className={clsx(orderNowLinkClass, "px-3 py-2 text-xs")}
                onClick={closeMobile}
              >
                <OrderNowIcon size="sm" />
                <span className="!text-white">Order Now</span>
              </Link>
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border-soft)] text-[var(--foreground)]"
                aria-label={mobileOpen ? "Close menu" : "Open menu"}
                aria-expanded={mobileOpen}
                onClick={() => setMobileOpen((open) => !open)}
              >
                {mobileOpen ? (
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <HeaderSearch onNavigate={closeMobile} />

          <div className="hidden shrink-0 items-center gap-5 md:flex lg:gap-6">
            <nav className="flex items-center gap-4 text-sm font-semibold text-[var(--foreground)]" aria-label="Primary">
              <Link href="/" className="hover:text-red-600">
                Home
              </Link>
              <NavDivider />
              <Link href="/menu" className="hover:text-red-600">
                Menu
              </Link>
              <NavDivider />
              <Link href="/brands" className="hover:text-red-600">
                Brands
              </Link>
            </nav>

            <Link
              href="/order-info"
              className={clsx(orderNowLinkClass, "px-5 py-2.5 text-sm")}
            >
              <OrderNowIcon />
              <span className="!text-white">Order Now</span>
            </Link>
          </div>
        </div>

        <nav
          className={clsx(
            "mt-3 flex flex-col gap-3 rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] p-4 text-sm font-semibold text-[var(--foreground)] shadow-md md:hidden",
            mobileOpen ? "flex" : "hidden",
          )}
          aria-label="Primary"
        >
          <Link href="/" className="hover:text-red-600" onClick={closeMobile}>
            Home
          </Link>
          <Link href="/menu" className="hover:text-red-600" onClick={closeMobile}>
            Menu
          </Link>
          <Link href="/brands" className="hover:text-red-600" onClick={closeMobile}>
            Brands
          </Link>
        </nav>
      </div>
    </header>
  );
}

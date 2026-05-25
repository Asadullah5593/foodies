"use client";

import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

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

export function SiteHeader() {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const closeMobile = () => setMobileOpen(false);

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const q = searchQuery.trim();
    router.push(q ? `/menu?search=${encodeURIComponent(q)}` : "/menu");
    closeMobile();
  };

  return (
    <header className="relative mb-4 overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] shadow-sm md:mb-6">
      <div className="h-1 bg-red-600" aria-hidden />

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

          <form onSubmit={handleSearch} className="w-full md:min-w-0 md:flex-1">
            <label htmlFor="site-header-search" className="sr-only">
              Search for cuisines
            </label>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                id="site-header-search"
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search for cuisines..."
                className="w-full rounded-full border border-[var(--border-soft)] bg-[var(--surface)] py-2.5 pl-11 pr-4 text-sm text-[var(--foreground)] placeholder:text-zinc-400 outline-none transition-shadow focus:border-red-300 focus:ring-2 focus:ring-red-100"
              />
            </div>
          </form>

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
              <Link href="/support.html" className="hover:text-red-600">
                Support
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
          <Link href="/support.html" className="hover:text-red-600" onClick={closeMobile}>
            Support
          </Link>
        </nav>
      </div>
    </header>
  );
}

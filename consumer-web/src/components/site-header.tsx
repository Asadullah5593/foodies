"use client";

import clsx from "clsx";
import Link from "next/link";
import { useState } from "react";

export function SiteHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="relative mb-4 rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3 shadow-sm md:mb-6 md:px-5 md:py-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/foodies-logo.png" alt="Foodies" className="h-10 w-10 shrink-0 rounded-full sm:h-11 sm:w-11" />
          <span className="truncate text-base font-black tracking-wide text-[var(--foreground)] sm:text-lg">FOODIES</span>
        </div>

        <nav
          className={clsx(
            "absolute left-5 right-5 top-full z-20 mt-2 flex-col gap-3 rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] p-4 text-sm font-semibold text-[var(--muted)] shadow-md md:static md:mt-0 md:flex md:flex-row md:items-center md:gap-6 md:border-0 md:bg-transparent md:p-0 md:shadow-none md:text-sm",
            mobileOpen ? "flex" : "hidden md:flex",
          )}
          aria-label="Primary"
        >
          <Link href="/" className="text-red-600 hover:underline" onClick={() => setMobileOpen(false)}>
            Home
          </Link>
          <Link href="/brands" className="hover:text-[var(--foreground)]" onClick={() => setMobileOpen(false)}>
            Brands
          </Link>
          <span className="cursor-default">About Us</span>
          <Link href="/support.html" className="hover:text-[var(--foreground)]" onClick={() => setMobileOpen(false)}>
            Support
          </Link>
        </nav>

        <button
          type="button"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--border-soft)] text-[var(--foreground)] md:hidden"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((o) => !o)}
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
    </header>
  );
}

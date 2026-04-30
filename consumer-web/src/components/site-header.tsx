"use client";

import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] px-5 py-4 shadow-sm">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/foodies-logo.png" alt="Foodies" className="h-12 w-12 rounded-full" />
        <span className="text-lg font-black tracking-wide text-[var(--foreground)]">FOODIES</span>
      </div>
      <nav className="flex flex-wrap items-center gap-5 text-sm font-semibold text-[var(--muted)]">
        <Link href="/" className="text-red-600 hover:underline">
          Home
        </Link>
        <Link href="/brands" className="hover:text-[var(--foreground)]">
          Brands
        </Link>
        <span className="cursor-default">About Us</span>
        <span className="cursor-default">Contact</span>
      </nav>
    </header>
  );
}

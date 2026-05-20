"use client";

import clsx from "clsx";
import Link from "next/link";

export function SiteFooter({ className }: { className?: string }) {
  const socialLinks = [
    { name: "Facebook", symbol: "f" },
    { name: "Instagram", symbol: "i" },
    { name: "Twitter", symbol: "x" },
  ];

  return (
    <footer
      className={clsx(
        "mt-10 overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] text-[var(--foreground)] shadow-sm",
        className,
      )}
    >
      <div className="h-1 bg-red-600" />

      <div className="grid gap-8 px-6 py-8 md:grid-cols-12 md:px-10">
        <div className="md:col-span-5">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/foodies-logo.png" alt="Foodies" className="h-11 w-11 rounded-full object-cover" />
            <div>
              <p className="text-sm font-black tracking-wide">FOODIES</p>
              <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Food Court</p>
            </div>
          </div>
          <p className="mt-4 max-w-sm text-sm text-[var(--muted)]">
            Multiple cuisines under one roof, served fresh every day at City Center Mall.
          </p>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm font-medium text-[var(--muted)]">
            <Link href="/" className="hover:text-red-600">
              Home
            </Link>
            <Link href="/brands" className="hover:text-red-600">
              Brands
            </Link>
            <Link href="/support.html" className="hover:text-red-600">
              Support
            </Link>
          </div>
        </div>

        <div className="md:col-span-2">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--muted)]">Visit us</p>
          <p className="mt-2 text-sm font-bold text-[var(--foreground)]">Foodies Food Court</p>
          <p className="mt-1 text-sm text-[var(--muted)]">City Center Mall</p>
        </div>

        <div className="md:col-span-2">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--muted)]">Opening hours</p>
          <p className="mt-2 text-sm font-bold text-[var(--foreground)]">10:00 AM - 10:00 PM</p>
          <p className="mt-1 text-sm text-[var(--muted)]">Everyday</p>
        </div>

        <div className="md:col-span-3">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--muted)]">Follow us</p>
          <div className="mt-3 flex gap-2">
            {socialLinks.map((social) => (
              <span
                key={social.name}
                className="grid h-9 w-9 place-items-center rounded-full border border-[var(--border-soft)] bg-[var(--surface-2)] text-xs font-bold uppercase text-[var(--muted)]"
                aria-label={social.name}
                title={social.name}
              >
                {social.symbol}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--border-soft)] px-6 py-4 text-sm text-[var(--muted)] md:px-10">
        <div className="flex flex-wrap gap-4">
          <Link href="/support.html" className="hover:text-red-600">
            Support
          </Link>
          <Link href="/privacy-policy.html" className="hover:text-red-600">
            Privacy policy
          </Link>
          <Link href="/terms-and-conditions.html" className="hover:text-red-600">
            Terms
          </Link>
        </div>
        <p>© {new Date().getFullYear()} Foodies Food Court</p>
      </div>
    </footer>
  );
}

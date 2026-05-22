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
        "mt-6 overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] text-[var(--foreground)] shadow-sm md:mt-10",
        className,
      )}
    >
      <div className="h-1 bg-red-600" />

      <div className="grid grid-cols-2 gap-x-4 gap-y-5 px-4 py-6 md:grid-cols-12 md:gap-8 md:px-10 md:py-8">
        <div className="col-span-2 md:col-span-5">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/foodies-logo.png" alt="Foodies" className="h-10 w-10 rounded-full object-cover md:h-11 md:w-11" />
            <div>
              <p className="text-sm font-black tracking-wide">FOODIES</p>
              <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)] md:text-xs">
                Food Court
              </p>
            </div>
          </div>
          <p className="mt-3 max-w-sm text-xs leading-relaxed text-[var(--muted)] md:mt-4 md:text-sm">
            Multiple cuisines under one roof, served fresh every day at City Center Mall.
          </p>
          <div className="mt-3 hidden flex-wrap gap-x-4 gap-y-2 text-sm font-medium text-[var(--muted)] md:flex">
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
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--muted)] md:text-xs">
            Visit us
          </p>
          <p className="mt-1.5 text-sm font-bold text-[var(--foreground)]">Foodies Food Court</p>
          <p className="mt-0.5 text-xs text-[var(--muted)] md:text-sm">City Center Mall</p>
        </div>

        <div className="md:col-span-2">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--muted)] md:text-xs">
            Opening hours
          </p>
          <p className="mt-1.5 text-sm font-bold text-[var(--foreground)]">10:00 AM - 10:00 PM</p>
          <p className="mt-0.5 text-xs text-[var(--muted)] md:text-sm">Everyday</p>
        </div>

        <div className="col-span-2 md:col-span-3">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--muted)] md:text-xs">
            Follow us
          </p>
          <div className="mt-2 flex gap-2 md:mt-3">
            {socialLinks.map((social) => (
              <span
                key={social.name}
                className="grid h-8 w-8 place-items-center rounded-full border border-[var(--border-soft)] bg-[var(--surface-2)] text-[10px] font-bold uppercase text-[var(--muted)] md:h-9 md:w-9 md:text-xs"
                aria-label={social.name}
                title={social.name}
              >
                {social.symbol}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col items-center gap-3 border-t border-[var(--border-soft)] px-4 py-4 text-center text-xs text-[var(--muted)] md:flex-row md:justify-between md:px-10 md:text-left md:text-sm">
        <div className="flex flex-wrap justify-center gap-3 md:justify-start md:gap-4">
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
        <p className="shrink-0">© {new Date().getFullYear()} Foodies Food Court</p>
      </div>
    </footer>
  );
}

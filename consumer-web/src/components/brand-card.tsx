"use client";

import Image from "next/image";
import Link from "next/link";
import { toImageUrl } from "@/lib/api/client";
import { useSessionStore } from "@/lib/store/session-store";
import type { Brand } from "@/lib/api/types";

/**
 * A single selectable brand tile (banner + logo + name + "View Menu"). The
 * whole card is one link — clicking the logo, the name, or "View Menu" selects
 * the brand and opens its menu. Shared by the homepage brand preview and the
 * all-brands page so both stay in visual sync.
 */
export function BrandCard({ brand }: { brand: Brand }) {
  const setBrandId = useSessionStore((s) => s.setBrandId);

  return (
    <Link
      href="/menu"
      onClick={() => setBrandId(brand.id)}
      className="group block overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] shadow-sm outline-none transition-all hover:border-red-200 hover:shadow-md focus-visible:ring-2 focus-visible:ring-red-500/50"
    >
      <div className="relative h-28 bg-[var(--surface-2)] md:h-44">
        <Image
          src="/Banner_02.jpg.jpeg"
          alt=""
          fill
          sizes="(max-width: 768px) 100vw, 25vw"
          className="object-cover opacity-90"
        />
      </div>
      <div className="relative -mt-8 px-4 pb-5 md:-mt-10 md:px-6 md:pb-6">
        <div className="relative mx-auto h-28 w-28 rounded-full border border-[var(--border-soft)] bg-white p-2 shadow-sm transition-transform duration-200 group-hover:scale-105 md:h-40 md:w-40 md:p-3">
          {brand.logo_url ? (
            <Image
              src={toImageUrl(brand.logo_url)}
              alt=""
              fill
              unoptimized
              sizes="160px"
              className="object-contain p-1"
            />
          ) : (
            <span
              aria-hidden="true"
              className="flex h-full items-center justify-center text-3xl font-black text-red-600"
            >
              {(brand.name || "?").slice(0, 1)}
            </span>
          )}
        </div>
        <h3 className="mt-3 text-center text-base font-black text-[var(--foreground)] md:mt-4 md:text-lg">
          {brand.name}
        </h3>
        <span className="mx-auto mt-4 flex items-center justify-center gap-2.5 text-sm font-black text-red-600 group-hover:underline">
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
        </span>
      </div>
    </Link>
  );
}

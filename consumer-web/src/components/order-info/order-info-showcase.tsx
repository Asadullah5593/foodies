import Image from "next/image";
import { orderRedirectConfig } from "@/lib/config/order-redirect";

export function OrderInfoShowcase() {
  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-[#FFF5F3] shadow-sm">
      <div className="relative min-h-[280px] sm:min-h-[340px] lg:min-h-[420px]">
        <Image
          src="/order-info/mid.jpeg"
          alt="Foodies app showcase section"
          fill
          sizes="100vw"
          className="object-contain object-right"
        />

        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#FFF5F3]/98 via-[#FFF5F3]/88 to-[#FFF5F3]/10"
          aria-hidden
        />

        <div className="relative z-10 flex min-h-[280px] items-center px-6 py-8 sm:min-h-[340px] sm:px-8 sm:py-10 lg:min-h-[420px] lg:py-12">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-red-600">
              {orderRedirectConfig.showcaseEyebrow}
            </p>
            <h2 className="mt-3 text-3xl font-black leading-tight text-zinc-900 sm:text-4xl">
              {orderRedirectConfig.showcaseTitle}
            </h2>
          </div>
        </div>
        </div>
    </section>
  );
}

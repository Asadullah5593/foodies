import Image from "next/image";
import { orderRedirectConfig } from "@/lib/config/order-redirect";
import { StoreBadgeLinks } from "./store-badge-links";

export function OrderInfoHero() {
  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] shadow-sm">
      <div className="relative min-h-[360px] sm:min-h-[430px] lg:min-h-[520px]">
        <Image
          src="/order-info/top.jpeg"
          alt="Foodies app top banner preview"
          fill
          priority
          sizes="100vw"
          className="object-contain object-right"
        />

        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-white/98 via-white/88 to-white/8"
          aria-hidden
        />

        <div className="relative z-10 flex min-h-[360px] items-center p-6 sm:min-h-[430px] sm:p-8 lg:min-h-[520px] lg:p-12">
          <div className="max-w-xl">
            <h1 className="text-4xl font-black leading-[1.04] tracking-tight text-[var(--foreground)] sm:text-5xl lg:text-[3.35rem]">
              <span className="block">{orderRedirectConfig.heroLine1}</span>
              <span className="block">{orderRedirectConfig.heroLine2}</span>
              <span className="mt-1 block text-red-600">{orderRedirectConfig.heroHighlight}</span>
            </h1>
            <p className="mt-6 max-w-lg text-sm leading-7 text-[var(--muted)] sm:text-base">
              {orderRedirectConfig.heroSubtitle}
            </p>
            <StoreBadgeLinks
              appStoreUrl={orderRedirectConfig.appStoreUrl}
              playStoreUrl={orderRedirectConfig.playStoreUrl}
              className="mt-8"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

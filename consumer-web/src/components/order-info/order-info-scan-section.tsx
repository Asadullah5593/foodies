import Image from "next/image";
import { orderRedirectConfig } from "@/lib/config/order-redirect";
import { OrderInfoQr } from "./order-info-qr";
import { StoreBadgeLinks } from "./store-badge-links";

export function OrderInfoScanSection() {
  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] shadow-sm">
      <div className="relative min-h-[300px] sm:min-h-[360px] lg:min-h-[440px]">
        <Image
          src="/order-info/last.jpeg"
          alt="Foodies app download section visual"
          fill
          sizes="100vw"
          className="object-contain object-right"
        />

        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-white/98 via-white/88 to-white/10"
          aria-hidden
        />

        <div className="relative z-10 flex min-h-[300px] items-center px-6 py-8 sm:min-h-[360px] sm:px-8 sm:py-10 lg:min-h-[440px] lg:py-12">
          <div className="max-w-xl">
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-red-600">
              Scan. Download. Enjoy.
            </p>
            <h2 className="mt-3 max-w-lg text-3xl font-black leading-tight text-zinc-900 sm:text-4xl">
              {orderRedirectConfig.downloadTitle}
            </h2>

            <div className="mt-8 flex flex-wrap items-center gap-6">
              <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                <OrderInfoQr size={136} />
              </div>
              <StoreBadgeLinks
                appStoreUrl={orderRedirectConfig.appStoreUrl}
                playStoreUrl={orderRedirectConfig.playStoreUrl}
                className="max-w-[260px]"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

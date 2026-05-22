import Image from "next/image";
import { orderRedirectConfig } from "@/lib/config/order-redirect";
import { StoreBadgeLinks } from "./store-badge-links";

function HeroCopy({ headingClassName }: { headingClassName: string }) {
  return (
    <>
      <h1 className={headingClassName}>
        <span className="block">{orderRedirectConfig.heroLine1}</span>
        <span className="block">{orderRedirectConfig.heroLine2}</span>
        <span className="mt-1 block text-red-600">{orderRedirectConfig.heroHighlight}</span>
      </h1>
      <p className="mt-3 max-w-lg text-xs leading-relaxed text-[var(--muted)] md:mt-6 md:text-sm md:leading-7 lg:text-base">
        {orderRedirectConfig.heroSubtitle}
      </p>
    </>
  );
}

export function OrderInfoHero() {
  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] shadow-sm">
      {/* Mobile: one card — text left, art fills the right via cover crop */}
      <div className="relative min-h-[400px] overflow-hidden md:hidden">
        <Image
          src="/order-info/top.jpeg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-[78%_center]"
        />

        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-white from-[48%] via-white/92 via-[58%] to-white/15"
          aria-hidden
        />

        <div className="relative z-10 flex min-h-[400px] flex-col justify-center p-5 pr-[34%]">
          <HeroCopy headingClassName="text-[1.55rem] font-black leading-[1.08] tracking-tight text-[var(--foreground)]" />
          <StoreBadgeLinks
            appStoreUrl={orderRedirectConfig.appStoreUrl}
            playStoreUrl={orderRedirectConfig.playStoreUrl}
            className="mt-4"
            mobileStack
          />
        </div>
      </div>

      {/* Desktop: original full-bleed banner */}
      <div className="relative hidden min-h-[430px] md:block lg:min-h-[520px]">
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

        <div className="relative z-10 flex min-h-[430px] items-center p-8 lg:min-h-[520px] lg:p-12">
          <div className="max-w-xl">
            <HeroCopy headingClassName="text-5xl font-black leading-[1.04] tracking-tight text-[var(--foreground)] lg:text-[3.35rem]" />
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

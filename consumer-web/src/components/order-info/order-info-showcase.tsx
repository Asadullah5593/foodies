import Image from "next/image";
import { orderRedirectConfig } from "@/lib/config/order-redirect";

export function OrderInfoShowcase() {
  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-[#FFF5F3] shadow-sm">
      <div className="relative min-h-[220px] overflow-hidden md:hidden">
        <Image
          src="/order-info/mid.jpeg"
          alt=""
          fill
          sizes="100vw"
          className="object-cover object-[75%_center]"
        />
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#FFF5F3] from-[42%] via-[#FFF5F3]/92 via-[55%] to-[#FFF5F3]/10"
          aria-hidden
        />
        <div className="relative z-10 flex min-h-[220px] flex-col justify-center p-5 pr-[32%]">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-red-600">
            {orderRedirectConfig.showcaseEyebrow}
          </p>
          <h2 className="mt-2 text-2xl font-black leading-tight text-zinc-900">
            {orderRedirectConfig.showcaseTitle}
          </h2>
        </div>
      </div>

      <div className="relative hidden min-h-[340px] md:block lg:min-h-[420px]">
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

        <div className="relative z-10 flex min-h-[340px] items-center px-8 py-10 lg:min-h-[420px] lg:py-12">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-red-600">
              {orderRedirectConfig.showcaseEyebrow}
            </p>
            <h2 className="mt-3 text-4xl font-black leading-tight text-zinc-900">
              {orderRedirectConfig.showcaseTitle}
            </h2>
          </div>
        </div>
      </div>
    </section>
  );
}

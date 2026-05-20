import Link from "next/link";
import { orderRedirectConfig } from "@/lib/config/order-redirect";

export function OrderInfoBottomCta() {
  const storeUrl = orderRedirectConfig.appStoreUrl;

  return (
    <section className="mb-6">
      <div className="flex flex-col items-start justify-between gap-8 rounded-2xl bg-zinc-900 px-8 py-10 sm:flex-row sm:items-center sm:px-10 sm:py-12">
        <div>
          <p className="text-sm font-semibold text-zinc-400">Craving something delicious?</p>
          <h2 className="mt-2 text-2xl font-black text-white sm:text-3xl">
            Let Foodies App
            <br />
            take care of it
          </h2>
          <p className="mt-4 text-sm text-zinc-500">Your favorite food is just a tap away!</p>
        </div>
        <Link
          href={storeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-2 rounded-full bg-red-600 px-8 py-4 text-sm font-bold text-white transition hover:bg-red-500"
        >
          Download the App Now
          <span aria-hidden>→</span>
        </Link>
      </div>
    </section>
  );
}

"use client";

import { useEffect, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import { orderRedirectConfig } from "@/lib/config/order-redirect";
import { AppShell } from "@/components/ui";
import { TopNav } from "@/components/top-nav";
import { toImageUrl } from "@/lib/api/client";
import { shouldUnoptimizeImage } from "@/lib/media-image";

export default function OrderInfoPage() {
  const { appDeepLink } = orderRedirectConfig;

  const qrSrc = useMemo(() => {
    const raw = orderRedirectConfig.qrImageUrl.trim();
    if (!raw) return "";
    if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
    return toImageUrl(raw.startsWith("/") ? raw : `/${raw}`);
  }, []);

  useEffect(() => {
    if (!appDeepLink) return;
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (!mobile) return;
    const t = window.setTimeout(() => {
      window.location.href = appDeepLink;
    }, 400);
    return () => window.clearTimeout(t);
  }, [appDeepLink]);

  return (
    <AppShell>
      <TopNav />
      <div className="mx-auto max-w-2xl px-1 pb-16 pt-2">
        <div className="overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)] shadow-sm">
          <div className="relative aspect-[16/9] w-full bg-[var(--surface-2)]">
            <Image
              src={orderRedirectConfig.bannerImageUrl}
              alt=""
              fill
              unoptimized={shouldUnoptimizeImage(orderRedirectConfig.bannerImageUrl)}
              priority
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 672px"
            />
          </div>
          <div className="space-y-6 p-6 sm:p-8">
            <div>
              <h1 className="text-2xl font-black tracking-tight text-[var(--foreground)] sm:text-3xl">
                {orderRedirectConfig.headline}
              </h1>
              <p className="mt-3 text-base leading-relaxed text-[var(--muted)]">
                {orderRedirectConfig.body}
              </p>
            </div>

            {appDeepLink ? (
              <p className="text-sm text-[var(--muted)]">
                On a phone, we try to open the app automatically. If nothing happens, use
                the store buttons below.
              </p>
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link
                href={orderRedirectConfig.playStoreUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex flex-1 items-center justify-center rounded-xl border border-[var(--border-soft)] bg-[var(--surface-2)] px-5 py-3 text-sm font-bold text-[var(--foreground)] transition hover:border-red-200 hover:bg-[var(--surface)] sm:flex-initial sm:min-w-[160px]"
              >
                Google Play
              </Link>
              <Link
                href={orderRedirectConfig.appStoreUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex flex-1 items-center justify-center rounded-xl border border-[var(--border-soft)] bg-[var(--surface-2)] px-5 py-3 text-sm font-bold text-[var(--foreground)] transition hover:border-red-200 hover:bg-[var(--surface)] sm:flex-initial sm:min-w-[160px]"
              >
                App Store
              </Link>
              {appDeepLink ? (
                <Link
                  href={appDeepLink}
                  className="inline-flex flex-1 items-center justify-center rounded-xl bg-red-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-red-500 sm:flex-initial sm:min-w-[160px]"
                >
                  Open app
                </Link>
              ) : null}
            </div>

            {qrSrc ? (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[var(--border-soft)] bg-[var(--surface-2)] p-6">
                <p className="text-center text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  Scan to download
                </p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrSrc} alt="App download QR" className="h-40 w-40 object-contain" />
              </div>
            ) : null}

            <p className="text-center text-sm text-[var(--muted)]">
              <Link href="/menu" className="font-semibold text-red-600 hover:underline">
                Back to menu
              </Link>
            </p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

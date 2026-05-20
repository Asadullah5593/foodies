"use client";

import { useEffect } from "react";
import { orderRedirectConfig } from "@/lib/config/order-redirect";
import { AppShell } from "@/components/ui";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { OrderInfoHero } from "@/components/order-info/order-info-hero";
import { OrderInfoFeatures } from "@/components/order-info/order-info-features";
import { OrderInfoShowcase } from "@/components/order-info/order-info-showcase";
import { OrderInfoScanSection } from "@/components/order-info/order-info-scan-section";
import { OrderInfoHowItWorks } from "@/components/order-info/order-info-how-it-works";
// import { OrderInfoBottomCta } from "@/components/order-info/order-info-bottom-cta";

export default function OrderInfoPage() {
  const { appDeepLink } = orderRedirectConfig;

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
      <SiteHeader />

      <OrderInfoHero />
      <OrderInfoFeatures />
      <OrderInfoShowcase />
      <OrderInfoScanSection />
      <OrderInfoHowItWorks />
      {/* <OrderInfoBottomCta /> */}

      <SiteFooter />
    </AppShell>
  );
}

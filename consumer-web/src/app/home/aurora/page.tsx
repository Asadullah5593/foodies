"use client";

import { TopNav } from "@/components/top-nav";
import { AppShell } from "@/components/ui";
import { HomeDesignAurora } from "@/components/home/home-design-aurora";

export default function AuroraHomePage() {
  return (
    <AppShell>
      <TopNav />
      <HomeDesignAurora />
    </AppShell>
  );
}

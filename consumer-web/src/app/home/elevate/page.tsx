"use client";

import { TopNav } from "@/components/top-nav";
import { AppShell } from "@/components/ui";
import { HomeDesignElevate } from "@/components/home/home-design-elevate";

export default function ElevateHomePage() {
  return (
    <AppShell>
      <TopNav />
      <HomeDesignElevate />
    </AppShell>
  );
}

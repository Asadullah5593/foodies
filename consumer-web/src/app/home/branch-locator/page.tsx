"use client";

import { TopNav } from "@/components/top-nav";
import { AppShell } from "@/components/ui";
import { HomeDesignBranchLocator } from "@/components/home/home-design-branch-locator";

export default function BranchLocatorHomePage() {
  return (
    <AppShell>
      <TopNav />
      <HomeDesignBranchLocator />
    </AppShell>
  );
}

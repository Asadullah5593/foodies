"use client";

import { TopNav } from "@/components/top-nav";
import { AppShell } from "@/components/ui";
import { HomeDesignNoir } from "@/components/home/home-design-noir";

export default function NoirHomePage() {
  return (
    <AppShell>
      <TopNav />
      <HomeDesignNoir />
    </AppShell>
  );
}

"use client";

import { TopNav } from "@/components/top-nav";
import { AppShell } from "@/components/ui";
import { HomeDesignNeoGrid } from "@/components/home/home-design-neo-grid";

export default function NeoGridHomePage() {
  return (
    <AppShell>
      <TopNav />
      <HomeDesignNeoGrid />
    </AppShell>
  );
}

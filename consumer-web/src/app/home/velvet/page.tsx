"use client";

import { TopNav } from "@/components/top-nav";
import { AppShell } from "@/components/ui";
import { HomeDesignVelvet } from "@/components/home/home-design-velvet";

export default function VelvetHomePage() {
  return (
    <AppShell>
      <TopNav />
      <HomeDesignVelvet />
    </AppShell>
  );
}

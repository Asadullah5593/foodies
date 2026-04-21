"use client";

import { TopNav } from "@/components/top-nav";
import { AppShell } from "@/components/ui";
import { HomeDesignStudio } from "@/components/home/home-design-studio";

export default function StudioHomePage() {
  return (
    <AppShell>
      <TopNav />
      <HomeDesignStudio />
    </AppShell>
  );
}

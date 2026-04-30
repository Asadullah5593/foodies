"use client";

import { Button, Card } from "@/components/ui";
import type { HomePageState } from "@/lib/hooks/use-home-page";

type Props = {
  home: HomePageState;
  className?: string;
};

/** Shown after branch selection when user returns to home (e.g. back navigation). */
export function HomeContinueCard({ home, className }: Props) {
  const { router, selectedBranchId } = home;

  if (!selectedBranchId) return null;

  return (
    <Card className={className}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--muted)]">Continue to the menu for this branch.</p>
        <Button type="button" onClick={() => router.push("/menu")}>
          Open menu
        </Button>
      </div>
    </Card>
  );
}

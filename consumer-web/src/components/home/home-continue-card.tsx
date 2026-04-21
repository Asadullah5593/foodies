"use client";

import { Button, Card, Loader } from "@/components/ui";
import type { HomePageState } from "@/lib/hooks/use-home-page";

type Props = {
  home: HomePageState;
  className?: string;
};

export function HomeContinueCard({ home, className }: Props) {
  const {
    router,
    selectedBranchId,
    selectedBranchBrandsQuery,
    selectedBranchHasBrands,
  } = home;

  if (!selectedBranchId) return null;

  return (
    <Card className={className}>
      {selectedBranchBrandsQuery.isLoading ? (
        <Loader label="Checking brands for selected branch..." />
      ) : selectedBranchHasBrands ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-[var(--muted)]">
            Branch selected. Explore curated brands for this branch.
          </p>
          <Button onClick={() => router.push("/brands")}>Go to brands</Button>
        </div>
      ) : (
        <p className="text-sm text-[var(--muted)]">
          This branch has no brands yet. Please choose another branch to continue.
        </p>
      )}
    </Card>
  );
}

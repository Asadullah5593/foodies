"use client";

import dynamic from "next/dynamic";

export const BranchMap = dynamic(
  () => import("@/components/branch-map").then((m) => m.BranchMap),
  { ssr: false },
);

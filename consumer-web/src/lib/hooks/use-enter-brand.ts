"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSessionStore } from "@/lib/store/session-store";
import type { Brand } from "@/lib/api/types";

/**
 * Selects a brand and navigates to its menu — the shared "enter this brand"
 * action used by the homepage and the all-brands page. Keeping it in one place
 * ensures every brand card behaves identically.
 */
export function useEnterBrand() {
  const router = useRouter();
  const setBrandId = useSessionStore((s) => s.setBrandId);

  return useCallback(
    (brand: Brand) => {
      setBrandId(brand.id);
      router.push("/menu");
    },
    [router, setBrandId],
  );
}

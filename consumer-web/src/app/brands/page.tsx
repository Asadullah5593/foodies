"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import Link from "next/link";
import Image from "next/image";

import { TopNav } from "@/components/top-nav";
import { AppShell, Button, Card, Loader } from "@/components/ui";
import { getBrandsByBranch } from "@/lib/api/consumer";
import { toImageUrl } from "@/lib/api/client";
import type { Brand } from "@/lib/api/types";
import { useSessionStore } from "@/lib/store/session-store";
import { HOME_IMAGE } from "@/lib/hooks/use-home-page";

const BRAND_FALLBACK_COVERS = [HOME_IMAGE.branchA, HOME_IMAGE.branchB, HOME_IMAGE.branchC];

function BrandTile({
  brand,
  coverUrl,
  onEnter,
}: {
  brand: Brand;
  coverUrl: string;
  onEnter: () => void;
}) {
  const logoUrl = useMemo(() => toImageUrl(brand.logo_url), [brand.logo_url]);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-[var(--border-soft)] bg-[var(--surface)]">
      <div className="absolute inset-0">
        {/* Cover image fallback + optional brand logo overlay */}
        <div className="relative h-full w-full">
          <Image
            src={coverUrl}
            alt=""
            fill
            unoptimized
            className="object-cover opacity-55"
          />
        </div>
        <div className="absolute inset-0 foodies-media-overlay" />
      </div>

      <div className="relative z-10 flex h-full min-h-[280px] flex-col justify-between p-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--muted)]">
            Culinary identity
          </p>

          <div className="mt-3 flex items-start gap-4">
            {logoUrl ? (
              <div className="relative h-12 w-12 flex-none overflow-hidden rounded-xl border border-[var(--border-soft)] bg-[var(--surface-2)]">
                <Image
                  src={logoUrl}
                  alt={`${brand.name} logo`}
                  fill
                  unoptimized
                  className="object-contain p-2"
                />
              </div>
            ) : null}

            <h2 className="text-4xl font-black leading-[1.05] tracking-tight text-[var(--foreground)]">
              {brand.name}
            </h2>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="text-xs font-semibold text-[var(--muted)]">
            Select your brand, then enter the menu.
          </div>
          <Button onClick={onEnter} className="px-5 py-2">
            Enter brand{" "}
            <span aria-hidden="true" className="ml-2 inline-flex items-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path
                  d="M5 12h13m0 0-6-6m6 6-6 6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function BrandsPage() {
  const router = useRouter();

  const selectedBranchId = useSessionStore((s) => s.selectedBranchId);
  const setBrandId = useSessionStore((s) => s.setBrandId);

  const brandsQuery = useQuery({
    queryKey: ["brands-by-branch", selectedBranchId],
    queryFn: () => getBrandsByBranch(selectedBranchId!),
    enabled: Boolean(selectedBranchId),
  });

  const tiles = useMemo(() => {
    const list = brandsQuery.data ?? [];
    return list.map((b, idx) => ({
      brand: b,
      coverUrl: BRAND_FALLBACK_COVERS[idx % BRAND_FALLBACK_COVERS.length],
      key: b.id,
    }));
  }, [brandsQuery.data]);

  const enterBrand = (brandId: number) => {
    setBrandId(brandId);
    router.push("/menu");
  };

  if (!selectedBranchId) {
    return (
      <AppShell>
        <TopNav />
        <motion.section
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
        >
          <Card>
            <p className="text-sm text-[var(--muted)]">
              Please choose a branch first to browse brands.
            </p>
            <div className="mt-3">
              <Button onClick={() => router.push("/")}>Go to branches</Button>
            </div>
          </Card>
        </motion.section>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <TopNav />
      <motion.section
        initial={false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm font-semibold text-white/70 hover:text-white/90">
              Back to branches
            </Link>
          </div>
        </div>

        {brandsQuery.isLoading ? <Loader label="Loading brands..." /> : null}

        {!brandsQuery.isLoading && !tiles.length ? (
          <Card>
            <p className="text-sm text-[var(--muted)]">No brands linked to this branch yet.</p>
          </Card>
        ) : null}

        {tiles.length ? (
          <div className="grid gap-4 md:grid-cols-2">
            {tiles.map(({ brand, coverUrl, key }) => (
              <BrandTile
                key={key}
                brand={brand}
                coverUrl={coverUrl}
                onEnter={() => enterBrand(brand.id)}
              />
            ))}
          </div>
        ) : null}

        {/* Editorial quote / footer (keeps the page feeling like the mockup). */}
        <div className="mt-12 text-center">
          <p className="mx-auto max-w-2xl text-lg leading-relaxed text-white/70">
            &quot;Gastronomy is the silent language of the city; each brand a unique dialect of flavor.&quot;
          </p>
          <div className="mt-10 border-t border-white/10 pt-8 text-xs text-white/55">
            © {new Date().getFullYear()} Culinary Hub. All rights reserved.
          </div>
        </div>
      </motion.section>
    </AppShell>
  );
}


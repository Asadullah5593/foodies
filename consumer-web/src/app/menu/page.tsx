"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ItemConfigModal } from "@/components/item-config-modal";
import { TopNav } from "@/components/top-nav";
import { AppShell, Button, Card, Input, Loader, Select } from "@/components/ui";
import {
  addCartItem,
  getBrandsByBranch,
  getCart,
  getMenu,
  getMenuItemDetail,
} from "@/lib/api/consumer";
import type { MenuItem } from "@/lib/api/types";
import { toImageUrl } from "@/lib/api/client";
import { useSessionStore } from "@/lib/store/session-store";

const MENU_ITEM_PLACEHOLDER = (label: string) => {
  const safe = (label || "Food").replace(/[<>&"]/g, "");

  // Split into up to 2 lines so long names don't get cut.
  const words = safe.split(/\s+/).filter(Boolean);
  let line1 = "";
  let line2 = "";
  if (words.length <= 1) {
    const text = safe;
    if (text.length <= 14) {
      line1 = text;
    } else if (text.length <= 22) {
      line1 = text.slice(0, 14);
      line2 = text.slice(14, 22);
    } else {
      line1 = text.slice(0, 16);
      line2 = text.slice(16, 32);
    }
  } else {
    const mid = Math.ceil(words.length / 2);
    line1 = words.slice(0, mid).join(" ");
    line2 = words.slice(mid).join(" ");
  }

  const maxLen = Math.max(line1.length, line2.length);
  const fontSize = maxLen > 22 ? 52 : maxLen > 16 ? 62 : 72;
  const lineHeight = Math.round(fontSize * 1.1);
  const y1 = 410;
  const y2 = y1 + lineHeight;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="750" viewBox="0 0 1200 750">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#dc2626" stop-opacity="0.22" />
      <stop offset="0.55" stop-color="#0f172a" stop-opacity="0.9" />
      <stop offset="1" stop-color="#000000" stop-opacity="1" />
    </linearGradient>
  </defs>
  <rect width="1200" height="750" fill="url(#g)"/>
  <g opacity="0.6">
    <circle cx="220" cy="220" r="160" fill="#dc2626"/>
    <circle cx="980" cy="520" r="220" fill="#dc2626"/>
  </g>
  <text
    x="600"
    y="${y1}"
    text-anchor="middle"
    font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto"
    font-size="${fontSize}"
    font-weight="900"
    fill="#f4f4f5"
    letter-spacing="1"
  >
    ${line1}
  </text>
  ${
    line2
      ? `<text x="600" y="${y2}" text-anchor="middle" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto" font-size="${fontSize}" font-weight="900" fill="#f4f4f5" letter-spacing="1">${line2}</text>`
      : ""
  }
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

export default function MenuPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const customer = useSessionStore((s) => s.customer);
  const selectedBranchId = useSessionStore((s) => s.selectedBranchId);
  const selectedBranch = useSessionStore((s) => s.selectedBranch);
  const selectedBrandId = useSessionStore((s) => s.selectedBrandId);
  const setBrandId = useSessionStore((s) => s.setBrandId);

  const [page, setPage] = useState(1);
  const pageSize = 9;

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchHighlightIndex, setSearchHighlightIndex] = useState(0);
  const [sortBy, setSortBy] = useState<"popular" | "price-asc" | "price-desc">(
    "popular",
  );
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [openConfig, setOpenConfig] = useState(false);
  const [activeItem, setActiveItem] = useState<MenuItem | null>(null);

  const brandsQuery = useQuery({
    queryKey: ["brands-by-branch", selectedBranchId],
    queryFn: () => getBrandsByBranch(selectedBranchId!),
    enabled: Boolean(selectedBranchId),
  });

  const menuQuery = useQuery({
    // Fetch full menu once for this branch+brand. Apply search/category filtering client-side.
    // This prevents layout jitter while the user types.
    queryKey: ["menu", selectedBranchId, selectedBrandId],
    queryFn: () => getMenu(selectedBranchId!, selectedBrandId!),
    enabled: Boolean(selectedBranchId && selectedBrandId),
  });

  const cartQuery = useQuery({
    queryKey: ["cart", customer?.phone, selectedBranchId],
    queryFn: () => getCart(customer!.phone, selectedBranchId!),
    enabled: Boolean(customer?.phone && selectedBranchId),
  });

  const addCartMutation = useMutation({
    mutationFn: addCartItem,
    onSuccess: () => {
      if (customer?.phone && selectedBranchId) {
        queryClient.invalidateQueries({
          queryKey: ["cart", customer.phone, selectedBranchId],
        });
      }
      setOpenConfig(false);
    },
  });

  const categories = useMemo(() => {
    const values = (menuQuery.data ?? [])
      .map((m) => m.category || "")
      .filter(Boolean) as string[];
    return ["all", ...new Set(values)];
  }, [menuQuery.data]);

  const effectiveCategory = useMemo(() => {
    return categories.includes(activeCategory) ? activeCategory : "all";
  }, [activeCategory, categories]);

  const filteredMenu = useMemo(() => {
    let list = [...(menuQuery.data ?? [])];
    const q = debouncedSearch.trim().toLowerCase();
    if (q) {
      list = list.filter((m) => {
        const name = (m.name ?? "").toLowerCase();
        const desc = (m.description ?? "").toLowerCase();
        return name.includes(q) || desc.includes(q);
      });
    }
    if (effectiveCategory !== "all") {
      list = list.filter(
        (m) => (m.category || "").toLowerCase() === effectiveCategory.toLowerCase(),
      );
    }
    if (sortBy === "price-asc") {
      list.sort((a, b) => a.price - b.price);
    } else if (sortBy === "price-desc") {
      list.sort((a, b) => b.price - a.price);
    }
    return list;
  }, [effectiveCategory, debouncedSearch, menuQuery.data, sortBy]);

  const searchSuggestions = useMemo(() => {
    const q = searchInput.trim().toLowerCase();
    if (!q) return [];

    type Suggestion = {
      key: string;
      type: "category" | "item";
      label: string;
      value: string;
    };

    const catMatches = categories
      .filter((c) => c !== "all")
      .filter((c) => c.toLowerCase().includes(q))
      .slice(0, 4);

    const scoredItems = (menuQuery.data ?? [])
      .map((m) => {
        const name = (m.name ?? "").toLowerCase();
        const desc = (m.description ?? "").toLowerCase();
        const starts = name.startsWith(q);
        const includes = name.includes(q) || desc.includes(q);
        return { m, starts, includes };
      })
      .filter((x) => x.includes)
      .sort((a, b) => Number(b.starts) - Number(a.starts))
      .slice(0, 6)
      .map((x) => x.m);

    const catSuggestions: Suggestion[] = catMatches.map((c) => ({
      key: `cat:${c}`,
      type: "category",
      label: c,
      value: c,
    }));

    const itemSuggestions: Suggestion[] = scoredItems.map((m) => ({
      key: `item:${m.id}`,
      type: "item",
      label: m.name,
      value: m.name,
    }));

    return [...catSuggestions, ...itemSuggestions];
  }, [categories, menuQuery.data, searchInput]);

  const suggestionsOpen = searchFocused && searchSuggestions.length > 0;

  const selectedBrand = useMemo(
    () => brandsQuery.data?.find((b) => b.id === selectedBrandId) ?? null,
    [brandsQuery.data, selectedBrandId],
  );

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(filteredMenu.length / pageSize));
  }, [filteredMenu.length, pageSize]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedSearch(searchInput);
    }, 250);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const clampedPage = useMemo(() => {
    return Math.min(Math.max(1, page), totalPages);
  }, [page, totalPages]);

  const pagedMenu = useMemo(() => {
    const start = (clampedPage - 1) * pageSize;
    return filteredMenu.slice(start, start + pageSize);
  }, [filteredMenu, clampedPage, pageSize]);

  const visiblePages = useMemo(() => {
    const radius = 2;
    const start = Math.max(1, clampedPage - radius);
    const end = Math.min(totalPages, clampedPage + radius);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }, [clampedPage, totalPages]);

  const openItemConfig = async (itemId: number) => {
    if (!selectedBranchId) return;
    const detail = await getMenuItemDetail(itemId, selectedBranchId);
    setActiveItem(detail);
    setOpenConfig(true);
  };

  if (!selectedBranchId) {
    return (
      <AppShell>
        <TopNav cartCount={cartQuery.data?.items?.length ?? 0} />
        <Card>
          <p className="text-sm text-zinc-300">
            Please choose a branch first to browse menu.
          </p>
          <div className="mt-3">
            <Button onClick={() => router.push("/")}>Go to branches</Button>
          </div>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <TopNav cartCount={cartQuery.data?.items?.length ?? 0} />
      <motion.section initial={false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
        <div className="grid gap-6 lg:grid-cols-[1fr_360px] lg:items-start">
          <div className="space-y-6">
            <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/50 p-4 sm:p-6">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_28%,rgba(220,38,38,0.35),transparent_55%),radial-gradient(circle_at_78%_12%,rgba(220,38,38,0.18),transparent_50%)] opacity-80" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />

              <div className="relative z-10 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="min-w-[260px]">
                  <p className="text-xs font-bold uppercase tracking-[0.22em] text-white/60">
                    {selectedBranch?.address || selectedBranch?.code || "Downtown branch"}
                  </p>
                  <h1 className="mt-2 text-4xl font-black leading-[0.95] tracking-tight text-white sm:text-5xl">
                    {(selectedBrand?.name ?? "Brand").toUpperCase()}{" "}
                    <span className="text-red-500">MENU</span>
                  </h1>
                  <p className="mt-3 max-w-xl text-sm text-white/70 sm:text-base">
                    Smooth ordering, fast customization, and curated flavor.
                  </p>
                </div>

                <div className="w-full sm:w-[420px]">
                  <Card className="border-white/10 bg-black/35 p-4 shadow-[0_0_0_1px_rgba(0,0,0,0.1)] backdrop-blur">
                    <div className="relative">
                      <Input
                        placeholder="POS search..."
                        value={searchInput}
                        onChange={(e) => {
                          setSearchHighlightIndex(0);
                          setSearchInput(e.target.value);
                        }}
                        className="pr-10"
                        onFocus={() => setSearchFocused(true)}
                        onBlur={() => {
                          window.setTimeout(() => setSearchFocused(false), 120);
                        }}
                        onKeyDown={(e) => {
                          if (!suggestionsOpen) return;
                          if (e.key === "ArrowDown") {
                            e.preventDefault();
                            setSearchHighlightIndex((i) =>
                              Math.min(searchSuggestions.length - 1, i + 1),
                            );
                          } else if (e.key === "ArrowUp") {
                            e.preventDefault();
                            setSearchHighlightIndex((i) => Math.max(0, i - 1));
                          } else if (e.key === "Enter") {
                            const s = searchSuggestions[searchHighlightIndex];
                            if (!s) return;
                            e.preventDefault();
                            if (s.type === "category") {
                              setActiveCategory(s.value);
                              setSearchInput("");
                              setDebouncedSearch("");
                              setPage(1);
                            } else {
                              setSearchInput(s.value);
                              setPage(1);
                            }
                          }
                        }}
                      />
                      <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/40">
                        ⌕
                      </div>

                      {suggestionsOpen ? (
                        <div className="absolute left-0 right-0 top-full z-10 mt-2 rounded-xl border border-white/10 bg-black/80 p-2 backdrop-blur">
                          <p className="mb-2 px-2 text-[10px] font-bold uppercase tracking-[0.22em] text-white/50">
                            Suggestions
                          </p>
                          <div className="max-h-56 overflow-y-auto">
                            {searchSuggestions.map((s, idx) => {
                              const active = idx === searchHighlightIndex;
                              return (
                                <button
                                  key={s.key}
                                  type="button"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => {
                                    if (s.type === "category") {
                                      setActiveCategory(s.value);
                                      setSearchInput("");
                                      setDebouncedSearch("");
                                      setPage(1);
                                      return;
                                    }
                                    setSearchInput(s.value);
                                    setPage(1);
                                  }}
                                  className={`flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left transition ${
                                    active
                                      ? "bg-red-600/25 text-white"
                                      : "text-white/70 hover:bg-white/5 hover:text-white"
                                  }`}
                                >
                                  <span className="truncate text-sm font-semibold">{s.label}</span>
                                  {s.type === "category" ? (
                                    <span className="shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-bold text-white/60">
                                      CAT
                                    </span>
                                  ) : null}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-3">
                      <Select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                      >
                        <option value="popular">Featured</option>
                        <option value="price-asc">Price: Low to high</option>
                        <option value="price-desc">Price: High to low</option>
                      </Select>
                    </div>

                    <div className="mt-4">
                      <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-white/50">
                        Categories
                      </p>
                      <Select
                        value={effectiveCategory}
                        onChange={(e) => {
                          setActiveCategory(e.target.value);
                          setPage(1);
                        }}
                      >
                        {categories.map((c) => (
                          <option key={c} value={c}>
                            {c === "all" ? "All" : c}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </Card>
                </div>
              </div>

              {brandsQuery.isLoading ? (
                <div className="relative z-10 mt-4">
                  <Loader label="Loading brands..." />
                </div>
              ) : !brandsQuery.data?.length ? (
                <div className="relative z-10 mt-4">
                  <p className="text-sm text-zinc-300">No brands linked to this branch yet.</p>
                </div>
              ) : (
                <div className="relative z-10 mt-4">
                  <div className="flex items-center gap-2 overflow-x-auto pb-2">
                    <span className="shrink-0 text-xs font-bold uppercase tracking-wide text-white/50">
                      Brand
                    </span>
                    {brandsQuery.data?.map((brand) => (
                      <button
                        key={brand.id}
                        type="button"
                        onClick={() => {
                          setBrandId(brand.id);
                          setPage(1);
                        }}
                        className={`shrink-0 rounded-full px-4 py-2 text-xs font-semibold transition ${
                          selectedBrandId === brand.id
                            ? "bg-red-600 text-white"
                            : "border border-white/10 bg-black/30 text-white/80 hover:bg-black/45"
                        }`}
                      >
                        {brand.name}
                      </button>
                    ))}
                    <Button
                      variant="secondary"
                      className="shrink-0"
                      onClick={() => router.push("/")}
                    >
                      Change branch
                    </Button>
                  </div>
                </div>
              )}

              {/* Category tabs moved into the POS-style filter card above */}
            </div>

            {!selectedBrandId ? (
              <Card>
                <p className="text-sm text-zinc-300">Choose a brand to load its menu.</p>
              </Card>
            ) : null}

            {selectedBrandId ? (
              <>
                {menuQuery.isLoading ? (
                  <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                    {Array.from({ length: pageSize }).map((_, idx) => (
                      <motion.div
                        key={`s-${idx}`}
                        initial={{ opacity: 0.6 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950"
                      >
                        <div className="relative aspect-[1/1] w-full bg-zinc-900 animate-pulse" />
                        <div className="space-y-3 p-5">
                          <div className="h-5 w-3/4 rounded bg-zinc-900 animate-pulse" />
                          <div className="h-4 w-full rounded bg-zinc-900 animate-pulse" />
                          <div className="mt-2 h-10 w-1/2 rounded bg-zinc-900 animate-pulse" />
                        </div>
                      </motion.div>
                    ))}
                  </div>
                ) : (
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={`page-${page}`}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.22 }}
                    >
                      {pagedMenu.length ? (
                        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                          {pagedMenu.map((item) => (
                            <motion.div
                              key={item.id}
                              layout
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              whileHover={{ y: -3 }}
                              transition={{ duration: 0.2 }}
                              onClick={() => {
                                // Whole card opens product detail modal.
                                if (openConfig) return;
                                openItemConfig(item.id);
                              }}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  if (openConfig) return;
                                  openItemConfig(item.id);
                                }
                              }}
                              className="group cursor-pointer rounded-2xl border border-zinc-800 bg-zinc-950"
                            >
                              <div className="relative aspect-[1/1] w-full bg-zinc-900 overflow-hidden rounded-t-2xl">
                                <img
                                  src={item.image_url ? toImageUrl(item.image_url) : MENU_ITEM_PLACEHOLDER(item.name)}
                                  alt={item.name}
                                  className={`h-full w-full opacity-95 transition duration-300 group-hover:scale-[1.02] ${
                                    item.image_url ? "object-cover" : "object-contain bg-zinc-950"
                                  }`}
                                />
                                <div className="absolute inset-0 foodies-media-overlay" />
                              </div>

                              <div className="space-y-3 p-5">
                                <div>
                                  <h3 className="break-words text-xl font-bold leading-snug text-white">
                                    {item.name}
                                  </h3>
                                  <p className="mt-1 line-clamp-2 text-sm text-zinc-400">
                                    {item.description || "No description"}
                                  </p>
                                </div>

                                <div className="flex flex-wrap gap-1">
                                  {item.variants?.length ? (
                                    <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs">
                                      Variants
                                    </span>
                                  ) : null}
                                  {item.addons?.length ? (
                                    <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs">
                                      Addons
                                    </span>
                                  ) : null}
                                  {item.modifier_groups?.length ? (
                                    <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs">
                                      Modifiers
                                    </span>
                                  ) : null}
                                </div>

                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-base font-semibold text-red-400">
                                    Rs. {item.price}
                                  </span>
                                  <Button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (openConfig) return;
                                      openItemConfig(item.id);
                                    }}
                                    className="bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500"
                                  >
                                    Add to cart
                                  </Button>
                                </div>
                              </div>
                            </motion.div>
                          ))}
                        </div>
                      ) : (
                        <Card>
                          <p className="text-sm text-zinc-300">
                            No items found for this brand/category.
                          </p>
                        </Card>
                      )}

                      {filteredMenu.length ? (
                        <div className="mt-6 flex flex-col items-center justify-between gap-4 md:flex-row">
                          <div className="text-xs text-white/60">
                            Page {clampedPage} of {totalPages}
                          </div>

                          <div className="flex items-center gap-2">
                            <Button
                              variant="secondary"
                              onClick={() => setPage((p) => Math.max(1, p - 1))}
                              disabled={clampedPage === 1}
                            >
                              Prev
                            </Button>

                            <div className="flex max-w-[280px] items-center gap-1 overflow-x-auto">
                              {visiblePages.map((p) => (
                                <button
                                  key={p}
                                  type="button"
                                  onClick={() => setPage(p)}
                                  className={`h-9 min-w-9 rounded-full px-3 text-xs font-semibold transition ${
                                    p === clampedPage
                                      ? "bg-red-600 text-white"
                                      : "border border-white/10 bg-black/30 text-white/70 hover:bg-black/45"
                                  }`}
                                >
                                  {p}
                                </button>
                              ))}
                            </div>

                            <Button
                              variant="secondary"
                              onClick={() =>
                                setPage((p) => Math.min(totalPages, p + 1))
                              }
                              disabled={clampedPage === totalPages}
                            >
                              Next
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </motion.div>
                  </AnimatePresence>
                )}
              </>
            ) : null}
          </div>

          <div className="lg:sticky lg:top-24">
            <Card className="border-white/10 bg-black/40 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-white/60">
                Current Order
              </p>
              <p className="mt-2 text-3xl font-black text-white">
                {cartQuery.data?.items?.length ?? 0}
                <span className="ml-2 text-sm font-semibold text-white/60">items</span>
              </p>

              <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-3">
                <p className="text-sm text-white/70">
                  {customer
                    ? "Ready when you are. Add items, then checkout."
                    : "Login is required to add items and checkout."}
                </p>
              </div>

              <Button
                className="mt-4 w-full"
                onClick={() => router.push("/checkout")}
                disabled={!customer || !(cartQuery.data?.items?.length ?? 0)}
              >
                Proceed to checkout
              </Button>

              <Button
                variant="secondary"
                className="mt-2 w-full"
                onClick={() => router.push("/")}
              >
                Change branch
              </Button>
            </Card>
          </div>
        </div>
      </motion.section>

      <ItemConfigModal
        key={`${activeItem?.id ?? "none"}-${openConfig ? "open" : "closed"}`}
        item={activeItem}
        open={openConfig}
        onClose={() => setOpenConfig(false)}
        onConfirm={(value) => {
          if (!customer?.phone || !selectedBranchId || !activeItem) {
            router.push("/login?redirect=/menu");
            return;
          }
          addCartMutation.mutate({
            phone: customer.phone,
            branch_id: selectedBranchId,
            menu_item_id: activeItem.id,
            quantity: value.quantity,
            variant_id: value.variant_id,
            addons: value.addons,
            modifiers: value.modifiers,
            notes: value.notes,
          });
        }}
      />
    </AppShell>
  );
}

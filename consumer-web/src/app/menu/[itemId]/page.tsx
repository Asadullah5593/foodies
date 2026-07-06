"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from "react";
import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { AppShell, Card } from "@/components/ui";
import {
  getMenuItemDetail,
  getTenantBrands,
  getTenantMenuByBrand,
  getTenantMenuItem,
} from "@/lib/api/consumer";
import { toImageUrl } from "@/lib/api/client";
import { menuImageUrl } from "@/lib/menu-image-url";
import { shouldUnoptimizeImage } from "@/lib/media-image";
import { useMenuImageLoaded } from "@/lib/use-menu-image-loaded";
import { orderRedirectConfig } from "@/lib/config/order-redirect";
import { useSessionStore } from "@/lib/store/session-store";
import type { Modifier, ModifierGroup, Variant } from "@/lib/api/types";
import {
  computeModifiersPrice,
  resolveMaxSelect,
  resolveMinSelect,
  resolveModifierUnitPrice,
  sizeKeyForVariant,
} from "@/lib/modifier-pricing";

const COLORS = {
  brand: "#E4002B",
  text: "#111113",
  muted: "#5f6368",
  line: "#e5e7eb",
  bg: "#f8f8f8",
} as const;

const SERVICE_OPTIONS = [
  { id: "delivery", label: "Delivery", icon: "truck" },
  { id: "pickup", label: "Pickup", icon: "bag" },
  { id: "dine_in", label: "Dine-In", icon: "utensils" },
] as const;

type ServiceChannelId = (typeof SERVICE_OPTIONS)[number]["id"];

/** Effective channels from API `available_for_order_types`; legacy/null = all. */
function itemAvailableOrderChannels(item: { available_for_order_types?: string[] | null }): ServiceChannelId[] {
  const raw = item.available_for_order_types;
  const canonical: ServiceChannelId[] = ["delivery", "pickup", "dine_in"];
  if (!raw?.length) return [...canonical];
  const set = new Set<string>();
  for (const x of raw) {
    const n = String(x).toLowerCase().trim();
    if (n === "takeaway") set.add("pickup");
    else set.add(n);
  }
  const picked = canonical.filter((id) => set.has(id));
  return picked.length ? picked : [...canonical];
}

const TITLE_SKELETON = [68, 92, 55];
const EMPTY_NUMBER_ARRAY: number[] = [];
const EMPTY_QTY_MAP: Record<number, number> = {};

/** "1: Rs.99, 2: Rs.169, 3: Rs.249" — the POS-style summary of a group's quantity-tiered extra price. */
function formatTiers(tiers: Record<string, number>): string {
  return Object.keys(tiers)
    .map(Number)
    .filter((k) => Number.isFinite(k))
    .sort((a, b) => a - b)
    .map((k) => `${k}: Rs.${Number(tiers[String(k)]).toFixed(0)}`)
    .join(", ");
}

/** One size for every monetary amount on this page (totals, deltas, modifiers, add-ons, related). */
const PDP_PRICE_TEXT = "text-base font-bold tabular-nums leading-none text-red-600";

const CHECK_ICON = (
  <svg viewBox="0 0 20 20" fill="none" aria-hidden className="h-3 w-3">
    <path d="M5 10.5 8.2 13.7 15 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** SVG plus — avoids distorted text glyphs in tight circular buttons */
const ICON_PLUS_SM = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden className="h-[18px] w-[18px] shrink-0">
    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const ICON_CHEVRON_RIGHT_SM = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden className="h-4 w-4 shrink-0">
    <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ICON_CHEVRON_LEFT_SM = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden className="h-4 w-4 shrink-0">
    <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const THUMB_VISIBLE_COUNT = 4;
const THUMB_GAP_PX = 12;

function ImageSkeleton({ className }: { className?: string }) {
  return <div className={clsx("absolute inset-0 animate-pulse bg-neutral-200", className)} aria-hidden />;
}

type GallerySlide = {
  canonical: string;
  displaySrc: string;
  thumbSrc: string;
  isPlaceholder: boolean;
};

/** Main hero + thumbnail strip (consumer PDP). Main image first, then gallery URLs from admin. */
function ProductImageGallery({
  itemName,
  imageUrl,
  galleryUrls,
}: {
  itemName: string;
  imageUrl?: string | null;
  galleryUrls?: string[];
}) {
  const images = useMemo(() => {
    const out: GallerySlide[] = [];
    const seen = new Set<string>();
    const push = (raw: string | null | undefined, isPlaceholder = false) => {
      if (!raw?.trim()) return;
      const canonical = isPlaceholder ? raw : toImageUrl(raw);
      if (seen.has(canonical)) return;
      seen.add(canonical);
      out.push({
        canonical,
        displaySrc: isPlaceholder ? canonical : menuImageUrl(canonical, "display"),
        thumbSrc: isPlaceholder ? canonical : menuImageUrl(canonical, "thumb"),
        isPlaceholder,
      });
    };
    push(imageUrl?.trim() ? imageUrl : null);
    for (const g of galleryUrls ?? []) push(g);
    if (!out.length) push(MENU_ITEM_PLACEHOLDER(itemName), true);
    return out;
  }, [galleryUrls, imageUrl, itemName]);

  const [activeIdx, setActiveIdx] = useState(0);
  const thumbStripRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ active: false, startX: 0, scrollLeft: 0, moved: false });

  const clampedIdx = images.length ? Math.min(activeIdx, images.length - 1) : 0;
  const active = images[clampedIdx] ?? images[0]!;
  const showStrip = images.length > 1;

  const thumbSlotStyle = useMemo(() => {
    const gaps = (THUMB_VISIBLE_COUNT - 1) * THUMB_GAP_PX;
    const slot = `calc((100% - ${gaps}px) / ${THUMB_VISIBLE_COUNT})`;
    return { flex: `0 0 ${slot}`, width: slot, minWidth: slot } as const;
  }, []);

  const {
    loaded: heroLoaded,
    markLoaded: markHeroLoaded,
    imgRef: heroImgRef,
  } = useMenuImageLoaded(active.displaySrc, active.isPlaceholder);

  useEffect(() => {
    if (!showStrip) return;
    const el = thumbStripRef.current?.children[clampedIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [clampedIdx, showStrip]);

  useEffect(() => {
    const links: HTMLLinkElement[] = [];
    for (const offset of [-1, 1]) {
      const slide = images[clampedIdx + offset];
      if (!slide || slide.isPlaceholder) continue;
      const link = document.createElement("link");
      link.rel = "prefetch";
      link.as = "image";
      link.href = slide.displaySrc;
      document.head.appendChild(link);
      links.push(link);
    }
    return () => {
      for (const link of links) link.remove();
    };
  }, [clampedIdx, images]);

  const scrollStripByPage = (dir: -1 | 1) => {
    const el = thumbStripRef.current;
    if (!el) return;
    const slot = el.querySelector<HTMLElement>("[data-thumb-slot]");
    const stepPx = slot ? slot.offsetWidth + THUMB_GAP_PX : el.clientWidth * 0.85;
    el.scrollBy({ left: dir * stepPx, behavior: "smooth" });
  };

  const onStripPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // Only drag-scroll when pressing the strip background, not a thumbnail button.
    if ((e.target as HTMLElement).closest("[data-thumb-slot]")) return;
    const el = thumbStripRef.current;
    if (!el) return;
    dragRef.current = { active: true, startX: e.clientX, scrollLeft: el.scrollLeft, moved: false };
    el.setPointerCapture(e.pointerId);
  };

  const onStripPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active || !thumbStripRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    if (Math.abs(dx) > 4) dragRef.current.moved = true;
    thumbStripRef.current.scrollLeft = dragRef.current.scrollLeft - dx;
  };

  const endStripDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    thumbStripRef.current?.releasePointerCapture(e.pointerId);
  };

  return (
    <div className="min-w-0">
      <motion.div
        className="relative overflow-hidden rounded-2xl border bg-neutral-100"
        style={{ borderColor: COLORS.line }}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="relative aspect-[4/3] w-full" key={active.displaySrc}>
          {!heroLoaded ? <ImageSkeleton /> : null}
          <Image
            ref={heroImgRef}
            src={active.displaySrc}
            alt={itemName}
            fill
            unoptimized={shouldUnoptimizeImage(active.displaySrc)}
            className={active.isPlaceholder ? "object-contain" : "object-cover"}
            sizes="(max-width: 1024px) 100vw, 50vw"
            priority
            onLoad={markHeroLoaded}
          />
        </div>
      </motion.div>

      {showStrip ? (
        <motion.div
          className="mt-4 flex items-stretch gap-2.5 sm:mt-5 sm:gap-3"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.05 }}
        >
          <button
            type="button"
            onClick={() => scrollStripByPage(-1)}
            className="inline-flex h-11 w-11 shrink-0 self-center items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-700 shadow-sm transition hover:border-neutral-300 hover:bg-neutral-50 sm:h-12 sm:w-12"
            aria-label="Scroll thumbnails left"
          >
            {ICON_CHEVRON_LEFT_SM}
          </button>

          <div
            ref={thumbStripRef}
            role="region"
            aria-label="Product image thumbnails"
            className={clsx(
              "flex min-w-0 flex-1 touch-pan-x select-none overflow-x-auto py-0.5",
              "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
              "cursor-grab active:cursor-grabbing",
            )}
            style={{ gap: THUMB_GAP_PX }}
            onPointerDown={onStripPointerDown}
            onPointerMove={onStripPointerMove}
            onPointerUp={endStripDrag}
            onPointerCancel={endStripDrag}
            onPointerLeave={(e) => {
              if (dragRef.current.active) endStripDrag(e);
            }}
          >
            {images.map((img, idx) => (
              <ThumbSlot
                key={img.canonical}
                img={img}
                selected={idx === clampedIdx}
                index={idx}
                total={images.length}
                slotStyle={thumbSlotStyle}
                stripRef={thumbStripRef}
                onSelect={() => setActiveIdx(idx)}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => scrollStripByPage(1)}
            className="inline-flex h-11 w-11 shrink-0 self-center items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-700 shadow-sm transition hover:border-neutral-300 hover:bg-neutral-50 sm:h-12 sm:w-12"
            aria-label="Scroll thumbnails right"
          >
            {ICON_CHEVRON_RIGHT_SM}
          </button>
        </motion.div>
      ) : null}
    </div>
  );
}

function ThumbSlot({
  img,
  selected,
  index,
  total,
  slotStyle,
  stripRef,
  onSelect,
}: {
  img: GallerySlide;
  selected: boolean;
  index: number;
  total: number;
  slotStyle: { flex: string; width: string; minWidth: string };
  stripRef: React.RefObject<HTMLDivElement | null>;
  onSelect: () => void;
}) {
  const [thumbSrc, setThumbSrc] = useState(img.thumbSrc);
  const { loaded, markLoaded, imgRef } = useMenuImageLoaded(
    thumbSrc,
    img.isPlaceholder,
  );
  const pointerRef = useRef({ startX: 0, scrollLeft: 0, moved: false });

  const onThumbPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    pointerRef.current = {
      startX: e.clientX,
      scrollLeft: stripRef.current?.scrollLeft ?? 0,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onThumbPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const dx = e.clientX - pointerRef.current.startX;
    if (Math.abs(dx) <= 4) return;
    pointerRef.current.moved = true;
    if (stripRef.current) {
      stripRef.current.scrollLeft = pointerRef.current.scrollLeft - dx;
    }
  };

  const onThumbPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (!pointerRef.current.moved) onSelect();
    pointerRef.current.moved = false;
  };

  return (
    <button
      type="button"
      data-thumb-slot
      style={slotStyle}
      className={clsx(
        "relative aspect-square shrink-0 overflow-hidden rounded-xl border-2 bg-neutral-100 transition",
        selected ? "border-red-600 shadow-sm" : "border-transparent opacity-80 hover:opacity-100",
      )}
      aria-label={`Show image ${index + 1} of ${total}`}
      aria-current={selected ? "true" : undefined}
      onPointerDown={onThumbPointerDown}
      onPointerMove={onThumbPointerMove}
      onPointerUp={onThumbPointerUp}
      onPointerCancel={onThumbPointerUp}
    >
      {!loaded ? <ImageSkeleton className="rounded-xl" /> : null}
      <Image
        ref={imgRef}
        src={thumbSrc}
        alt=""
        fill
        unoptimized={shouldUnoptimizeImage(thumbSrc)}
        loading="eager"
        className={img.isPlaceholder ? "object-contain" : "object-cover"}
        sizes="(max-width: 1024px) 25vw, 120px"
        draggable={false}
        onLoad={markLoaded}
        onError={() => {
          if (thumbSrc !== img.canonical) {
            setThumbSrc(img.canonical);
          } else {
            markLoaded();
          }
        }}
      />
    </button>
  );
}

function MENU_ITEM_PLACEHOLDER(label: string) {
  const safe = (label || "Food").replace(/[<>&"]/g, "");
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
      <stop offset="0" stop-color="#fecaca" stop-opacity="0.9" />
      <stop offset="0.55" stop-color="#f4f4f5" stop-opacity="1" />
      <stop offset="1" stop-color="#e4e4e7" stop-opacity="1" />
    </linearGradient>
  </defs>
  <rect width="1200" height="750" fill="url(#g)"/>
  <g opacity="0.35">
    <circle cx="220" cy="220" r="160" fill="#E4002B"/>
    <circle cx="980" cy="520" r="220" fill="#E4002B"/>
  </g>
  <text x="600" y="${y1}" text-anchor="middle" font-family="ui-sans-serif, system-ui" font-size="${fontSize}" font-weight="900" fill="#18181b" letter-spacing="1">${line1}</text>
  ${
    line2
      ? `<text x="600" y="${y2}" text-anchor="middle" font-family="ui-sans-serif, system-ui" font-size="${fontSize}" font-weight="900" fill="#18181b" letter-spacing="1">${line2}</text>`
      : ""
  }
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function pickDefaultVariant(variants: Variant[]): Variant | null {
  if (!variants.length) return null;
  return variants.find((v) => v.is_default === true || v.isDefault === true) ?? variants[0] ?? null;
}

/** Pre-select modifiers required by min_select (first N in group order). */
function buildDefaultModifierIds(groups: ModifierGroup[], sizeKey: string | null | undefined): number[] {
  const ids: number[] = [];
  const picked = new Set<number>();
  for (const g of groups) {
    // Skip conditional groups whose trigger option isn't selected yet — they aren't shown or
    // required until one of their triggers has been picked (groups are in POS order, so an
    // earlier group can reveal a later one).
    const triggers = g.visible_when_modifier_ids;
    if (triggers?.length && !triggers.some((id) => picked.has(id))) continue;
    const min = resolveMinSelect(g, sizeKey);
    // Only pre-select options actually offered for the default size (e.g. no "Thin Crust" on 7").
    const mods = (g.modifiers ?? []).filter((m) => isModAvailableForSize(m, sizeKey));
    if (min === 0 || !mods.length) continue;
    const take = Math.min(min, mods.length);
    for (let i = 0; i < take; i++) {
      ids.push(mods[i]!.id);
      picked.add(mods[i]!.id);
    }
  }
  return ids;
}

/**
 * Match POS `ItemConfigModal` modifier order: size → base → sauce → cheese → garnish → meat → vegetable → other.
 * Consumer tenant menu uses a TypeORM M2M load without explicit join order, so we stabilize here.
 */
function sortModifierGroupsPosStyle(groups: ModifierGroup[]): ModifierGroup[] {
  const rank = (g: ModifierGroup): number => {
    const n = (g.name ?? "").toLowerCase();
    if (n.includes("size") || n.includes("inch")) return 10;
    if (n.includes("base") || n.includes("crust") || n.includes("dough")) return 20;
    if (n.includes("sauce")) return 30;
    if (n.includes("flavour") || n.includes("flavor") || n.includes("heat") || n.includes("spice")) return 35;
    if (n.includes("cheese")) return 40;
    if (n.includes("garnish")) return 45;
    if (n.includes("topping") && !n.includes("meat") && !n.includes("vegetable") && !n.includes("veggie")) return 55;
    if (n.includes("meat")) return 60;
    if (n.includes("vegetable") || n.includes("veggie")) return 70;
    const min = g.min_select ?? 0;
    const max = g.max_select ?? 99;
    if (max === 1 && min >= 1) return 52;
    if (max === 1 && min === 0) return 82;
    return 100;
  };
  return [...groups].sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    return a.id - b.id;
  });
}

function sortVariantsPosStyle(variants: Variant[]): Variant[] {
  return [...variants].sort((a, b) => {
    const sa = (a as Variant & { sort_order?: number }).sort_order ?? 0;
    const sb = (b as Variant & { sort_order?: number }).sort_order ?? 0;
    if (sa !== sb) return sa - sb;
    return a.id - b.id;
  });
}

/** Match POS/admin: render modifiers in the configured sort_order (then id as a stable tiebreak). */
function sortModifiersByOrder(modifiers: Modifier[]): Modifier[] {
  return [...modifiers].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id);
}

/** A modifier is offered for a size when it has no size restriction, or lists the chosen size. */
function isModAvailableForSize(mod: Modifier, sizeKey: string | null | undefined): boolean {
  return !mod.available_for_sizes?.length || !sizeKey || mod.available_for_sizes.includes(sizeKey);
}

/** Compact category label for the picker, dropping a leading "Choose your/a" so chips stay short. */
function shortCategoryName(name: string): string {
  const stripped = name.replace(/^\s*choose\s+(?:your\s+|a\s+|an\s+|the\s+)?/i, "").trim();
  return stripped || name;
}

/** A pickable category in the two-pane selector: a modifier group, or the synthetic add-ons bucket. */
type PdpCategory =
  | { key: string; kind: "group"; group: ModifierGroup }
  | { key: "addons"; kind: "addons" };

function iconNode(kind: (typeof SERVICE_OPTIONS)[number]["icon"]): JSX.Element {
  if (kind === "truck") {
    return (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path d="M3 7h11v8H3z" />
        <path d="M14 10h4l3 3v2h-7z" />
        <circle cx="7" cy="17" r="1.9" />
        <circle cx="18" cy="17" r="1.9" />
      </svg>
    );
  }
  if (kind === "bag") {
    return (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path d="M6 8h12l-1.1 11a2 2 0 0 1-2 1.8H9.1a2 2 0 0 1-2-1.8L6 8z" />
        <path d="M9 8V7a3 3 0 0 1 6 0v1" />
      </svg>
    );
  }
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M7 4v3M17 4v3M4 9h16M5 9l1 9a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-9" />
      <path d="M9 13h6M10.5 16h3" />
    </svg>
  );
}

export default function MenuItemDetailPage() {
  const params = useParams<{ itemId?: string | string[] }>();
  const selectedBrandId = useSessionStore((s) => s.selectedBrandId);
  const selectedBranchId = useSessionStore((s) => s.selectedBranchId);
  const parsedParam = Array.isArray(params?.itemId) ? params.itemId[0] : params?.itemId;
  const itemId = Number(parsedParam);
  const itemIdValid = Number.isFinite(itemId) && itemId > 0;

  const [selectionByItemId, setSelectionByItemId] = useState<
    Record<
      number,
      {
        variantId: number | null;
        modifierIds: number[];
        /** Per-modifier unit count (POS "×N" stepper); absent id ⇒ quantity 1. */
        modifierQty: Record<number, number>;
        addonIds: number[];
      }
    >
  >({});

  const brandsQuery = useQuery({
    queryKey: ["tenant-brands"],
    queryFn: () => getTenantBrands(),
    refetchOnMount: "always",
    refetchOnReconnect: true,
    staleTime: 0,
  });

  const menuQuery = useQuery({
    queryKey: ["tenant-menu", selectedBrandId],
    queryFn: () => getTenantMenuByBrand(selectedBrandId!),
    enabled: Boolean(selectedBrandId && itemIdValid),
  });

  const itemDetailQuery = useQuery({
    queryKey: ["menu-item-detail", itemId, selectedBrandId, selectedBranchId],
    queryFn: () =>
      selectedBranchId
        ? getMenuItemDetail(itemId, selectedBranchId)
        : getTenantMenuItem(selectedBrandId!, itemId),
    enabled: Boolean(selectedBrandId && itemIdValid),
    staleTime: 0,
    refetchOnMount: "always",
  });

  const allItems = useMemo(() => menuQuery.data ?? [], [menuQuery.data]);
  const currentItem = itemDetailQuery.data ?? null;
  const availableOrderChannels = useMemo(
    () => (currentItem ? itemAvailableOrderChannels(currentItem) : []),
    [currentItem],
  );
  const selectedBrand = useMemo(
    () => (brandsQuery.data ?? []).find((brand) => brand.id === selectedBrandId) ?? null,
    [brandsQuery.data, selectedBrandId],
  );

  const modifierGroupsOrdered = useMemo(() => {
    const raw = (currentItem?.modifier_groups ?? []).filter((g) => (g.modifiers?.length ?? 0) > 0);
    return sortModifierGroupsPosStyle(raw);
  }, [currentItem]);

  const variantsOrdered = useMemo(() => {
    if (!currentItem?.variants?.length) return [];
    return sortVariantsPosStyle(currentItem.variants);
  }, [currentItem]);

  const addonsOrdered = useMemo(() => {
    if (!currentItem?.addons?.length) return [];
    return [...currentItem.addons].sort((a, b) => a.id - b.id);
  }, [currentItem]);

  const defaultVariant = useMemo(
    () => (variantsOrdered.length ? pickDefaultVariant(variantsOrdered) : null),
    [variantsOrdered],
  );

  const defaultModifierIds = useMemo(
    () => buildDefaultModifierIds(modifierGroupsOrdered, defaultVariant?.size_key ?? null),
    [modifierGroupsOrdered, defaultVariant],
  );

  const defaultSelection = useMemo(
    () => ({
      variantId: defaultVariant?.id ?? null,
      modifierIds: defaultModifierIds,
      modifierQty: {} as Record<number, number>,
      addonIds: [] as number[],
    }),
    [defaultModifierIds, defaultVariant?.id],
  );

  const currentSelection = currentItem
    ? (selectionByItemId[currentItem.id] ?? defaultSelection)
    : null;
  const selectedVariantId = currentSelection?.variantId ?? null;
  const selectedModifierIds = currentSelection?.modifierIds ?? EMPTY_NUMBER_ARRAY;
  const selectedModifierQty = currentSelection?.modifierQty ?? EMPTY_QTY_MAP;
  const selectedAddonIds = currentSelection?.addonIds ?? EMPTY_NUMBER_ARRAY;

  /** Units chosen for a modifier (the ×N stepper); defaults to 1 when selected. */
  const quantityOf = (id: number) => Math.max(1, Math.floor(selectedModifierQty[id] ?? 1));

  const selectedVariant = useMemo(() => {
    if (!currentItem || selectedVariantId == null) return null;
    return variantsOrdered.find((v) => v.id === selectedVariantId) ?? null;
  }, [currentItem, selectedVariantId, variantsOrdered]);

  /** size_key of the chosen variant drives per-size modifier pricing (null = flat prices). */
  const sizeKey = useMemo(() => sizeKeyForVariant(selectedVariant), [selectedVariant]);

  /**
   * Selections that are actually offered for the current size. Options restricted by
   * `available_for_sizes` are hidden in the picker, so we drop them here too — keeping the
   * category status, the active marks, and the total all consistent with what's on screen.
   */
  const effectiveSelectedModifierIds = useMemo(() => {
    if (!currentItem) return selectedModifierIds;
    const modById = new Map<number, Modifier>();
    for (const g of currentItem.modifier_groups ?? []) for (const m of g.modifiers ?? []) modById.set(m.id, m);
    return selectedModifierIds.filter((id) => {
      const mod = modById.get(id);
      return mod ? isModAvailableForSize(mod, sizeKey) : false;
    });
  }, [currentItem, selectedModifierIds, sizeKey]);

  /**
   * Conditional groups: a group with `visible_when_modifier_ids` only appears once one of those
   * trigger options is selected (e.g. a salad's "Choose your Flavour" shows only after
   * "Peri Peri Chicken" is picked). Null/empty = always visible. Keyed off the CURRENT selection,
   * so it updates reactively as options are toggled.
   */
  const selectedModifierIdSet = useMemo(
    () => new Set(effectiveSelectedModifierIds),
    [effectiveSelectedModifierIds],
  );
  const isGroupVisible = useCallback(
    (g?: { visible_when_modifier_ids?: number[] | null }): boolean => {
      const triggers = g?.visible_when_modifier_ids;
      if (!triggers || triggers.length === 0) return true;
      return triggers.some((id) => selectedModifierIdSet.has(id));
    },
    [selectedModifierIdSet],
  );

  /** Only modifier groups that are visible under the current selection. */
  const visibleModifierGroups = useMemo(
    () => modifierGroupsOrdered.filter((g) => isGroupVisible(g)),
    [modifierGroupsOrdered, isGroupVisible],
  );

  /**
   * Ids selected but belonging to a currently-hidden conditional group. Ignored for pricing,
   * completeness and totals — and dropped from the order — so everything matches what's actually
   * offered (mirrors the server, which ignores hidden groups). Derived, not cleared from state,
   * so a re-revealed group keeps the user's prior picks.
   */
  const hiddenModifierIds = useMemo(() => {
    const hidden = new Set<number>();
    for (const g of modifierGroupsOrdered) {
      if (!isGroupVisible(g)) for (const mod of g.modifiers ?? []) hidden.add(mod.id);
    }
    return hidden;
  }, [modifierGroupsOrdered, isGroupVisible]);

  /** Effective selections that count: size-available AND not in a hidden group. */
  const pricedModifierIds = useMemo(
    () => effectiveSelectedModifierIds.filter((id) => !hiddenModifierIds.has(id)),
    [effectiveSelectedModifierIds, hiddenModifierIds],
  );

  /** Left-pane categories: every VISIBLE modifier group (with options), plus add-ons as a final bucket. */
  const categories = useMemo<PdpCategory[]>(() => {
    const cats: PdpCategory[] = visibleModifierGroups.map((g) => ({
      key: `g-${g.id}`,
      kind: "group" as const,
      group: g,
    }));
    if (addonsOrdered.length) cats.push({ key: "addons", kind: "addons" as const });
    return cats;
  }, [visibleModifierGroups, addonsOrdered]);

  const defaultCategoryKey = categories[0]?.key ?? null;
  // The user's chosen category persists only while it still exists; when the item (and thus the
  // category set) changes, the stale override no longer matches and we fall back to the first
  // category — derived during render, so no resetting effect is needed.
  const [activeCategoryOverride, setActiveCategoryOverride] = useState<string | null>(null);
  const activeCategoryKey =
    activeCategoryOverride && categories.some((c) => c.key === activeCategoryOverride)
      ? activeCategoryOverride
      : defaultCategoryKey;
  const activeCategory =
    categories.find((c) => c.key === activeCategoryKey) ?? categories[0] ?? null;

  /** Total chosen units in a group (sum of per-modifier quantities) — what min/max gate on, POS-style. */
  const unitsInGroup = (group: ModifierGroup) => {
    const ids = new Set((group.modifiers ?? []).map((m) => m.id));
    return effectiveSelectedModifierIds
      .filter((id) => ids.has(id))
      .reduce((sum, id) => sum + quantityOf(id), 0);
  };

  const modifierPriceTotal = useMemo(() => {
    if (!currentItem) return 0;
    const uniqueIds = Array.from(new Set(pricedModifierIds));
    return computeModifiersPrice(
      currentItem.modifier_groups ?? [],
      uniqueIds.map((id) => ({ modifier_id: id, quantity: selectedModifierQty[id] ?? 1 })),
      sizeKey,
    );
  }, [currentItem, pricedModifierIds, selectedModifierQty, sizeKey]);

  const relatedProducts = useMemo(() => {
    if (!currentItem) return [];
    const sameCategory = allItems.filter(
      (it) => it.id !== currentItem.id && it.category === currentItem.category,
    );
    const others = allItems.filter((it) => it.id !== currentItem.id && it.category !== currentItem.category);
    return [...sameCategory, ...others].slice(0, 8);
  }, [allItems, currentItem]);

  const startingFrom = useMemo(() => {
    if (!currentItem) return 0;
    const variantExtra = defaultVariant?.price_modifier ?? 0;
    const groups = currentItem.modifier_groups ?? [];
    const modExtra = computeModifiersPrice(
      groups,
      Array.from(new Set(defaultModifierIds)).map((id) => ({ modifier_id: id, quantity: 1 })),
      sizeKeyForVariant(defaultVariant),
    );
    return currentItem.price + variantExtra + modExtra;
  }, [currentItem, defaultModifierIds, defaultVariant]);

  const selectedPrice = useMemo(() => {
    if (!currentItem) return 0;
    const variantExtra = selectedVariant?.price_modifier ?? 0;
    const addonExtra = (currentItem.addons ?? [])
      .filter((addon) => selectedAddonIds.includes(addon.id))
      .reduce((sum, addon) => sum + addon.price, 0);
    return currentItem.price + variantExtra + modifierPriceTotal + addonExtra;
  }, [currentItem, modifierPriceTotal, selectedAddonIds, selectedVariant?.price_modifier]);

  const updateSelection = (
    next: Partial<{
      variantId: number | null;
      modifierIds: number[];
      modifierQty: Record<number, number>;
      addonIds: number[];
    }>,
  ) => {
    if (!currentItem) return;
    const existing = selectionByItemId[currentItem.id] ?? defaultSelection;
    setSelectionByItemId((prev) => ({
      ...prev,
      [currentItem.id]: { ...existing, ...next },
    }));
  };

  const toggleModifier = (group: ModifierGroup, modifierId: number) => {
    if (!currentItem) return;
    const existing = selectionByItemId[currentItem.id] ?? defaultSelection;
    const selected = [...existing.modifierIds];
    const qtyMap = { ...(existing.modifierQty ?? {}) };
    const modsInGroup = new Set((group.modifiers ?? []).map((m) => m.id));
    const isSelected = selected.includes(modifierId);
    const maxSel = resolveMaxSelect(group, sizeKey) ?? 99;
    const minSel = resolveMinSelect(group, sizeKey);
    const qOf = (id: number) => Math.max(1, Math.floor(qtyMap[id] ?? 1));
    const unitsIn = selected.filter((id) => modsInGroup.has(id)).reduce((s, id) => s + qOf(id), 0);

    // Single-select: tapping swaps the chosen option (and only deselects when nothing is required).
    if (maxSel === 1) {
      if (isSelected) {
        if (minSel === 0) {
          delete qtyMap[modifierId];
          updateSelection({ modifierIds: selected.filter((id) => id !== modifierId), modifierQty: qtyMap });
        }
        return;
      }
      for (const id of selected) if (modsInGroup.has(id)) delete qtyMap[id];
      qtyMap[modifierId] = 1;
      updateSelection({ modifierIds: [...selected.filter((id) => !modsInGroup.has(id)), modifierId], modifierQty: qtyMap });
      return;
    }

    // Multi-select: max gates on total units. Deselecting below min is ALLOWED (the category
    // status flips to "Required") — with exactly-N per-size limits (min == max), blocking
    // deselection would deadlock the group on its pre-picked defaults.
    if (isSelected) {
      delete qtyMap[modifierId];
      updateSelection({ modifierIds: selected.filter((id) => id !== modifierId), modifierQty: qtyMap });
      return;
    }
    if (unitsIn >= maxSel) return;
    qtyMap[modifierId] = 1;
    updateSelection({ modifierIds: [...selected, modifierId], modifierQty: qtyMap });
  };

  /** POS "×N" stepper: clamp to the group's remaining unit allowance; 0 deselects. */
  const setModifierQuantity = (group: ModifierGroup, modifierId: number, nextQty: number) => {
    if (!currentItem) return;
    const existing = selectionByItemId[currentItem.id] ?? defaultSelection;
    const selected = [...existing.modifierIds];
    if (!selected.includes(modifierId)) return;
    const qtyMap = { ...(existing.modifierQty ?? {}) };
    const modsInGroup = new Set((group.modifiers ?? []).map((m) => m.id));
    const maxSel = resolveMaxSelect(group, sizeKey) ?? 99;
    const qOf = (id: number) => Math.max(1, Math.floor(qtyMap[id] ?? 1));
    const unitsOther = selected
      .filter((id) => modsInGroup.has(id) && id !== modifierId)
      .reduce((s, id) => s + qOf(id), 0);

    if (nextQty <= 0) {
      // Removal below min is allowed (status shows "Required") — see toggleModifier.
      delete qtyMap[modifierId];
      updateSelection({ modifierIds: selected.filter((id) => id !== modifierId), modifierQty: qtyMap });
      return;
    }
    qtyMap[modifierId] = Math.max(1, Math.min(nextQty, Math.max(1, maxSel - unitsOther)));
    updateSelection({ modifierIds: selected, modifierQty: qtyMap });
  };

  const toggleAddon = (addonId: number) => {
    const nextAddons = selectedAddonIds.includes(addonId)
      ? selectedAddonIds.filter((id) => id !== addonId)
      : [...selectedAddonIds, addonId];
    updateSelection({ addonIds: nextAddons });
  };

  const hasVariants = variantsOrdered.length > 0;

  if (!itemIdValid) {
    return (
      <AppShell>
        <SiteHeader />
        <Card className="py-14 text-center">
          <h1 className="text-2xl font-black text-[var(--foreground)]">Invalid product link</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">This item URL is not valid.</p>
          <Link href="/menu" className="mt-6 inline-flex rounded-lg bg-red-600 px-5 py-2 text-sm font-bold text-white">
            Back to menu
          </Link>
        </Card>
        <SiteFooter />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="font-[family-name:var(--font-geist-sans),system-ui,sans-serif] text-[13px] leading-normal text-[var(--foreground)] antialiased">
        <SiteHeader />

        {!selectedBrandId ? (
          <Card className="py-14 text-center">
            <h1 className="text-2xl font-black text-[var(--foreground)]">Select a brand first</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">
              We need your selected brand to load product details.
            </p>
            <Link href="/menu" className="mt-6 inline-flex rounded-lg bg-red-600 px-5 py-2 text-sm font-bold text-white">
              Go to menu
            </Link>
          </Card>
        ) : itemDetailQuery.isLoading ? (
          <section className="rounded-2xl border bg-white p-4 shadow-sm sm:p-6" style={{ borderColor: COLORS.line }}>
            <div className="animate-pulse space-y-5">
              <div className="h-4 w-72 rounded bg-neutral-200" />
              <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div className="aspect-[4/3] rounded-2xl bg-neutral-200" />
                <div className="space-y-4">
                  <div className="h-6 w-40 rounded bg-neutral-200" />
                  <div className="h-12 w-96 rounded bg-neutral-200" />
                  <div className="space-y-2">
                    {TITLE_SKELETON.map((w, idx) => (
                      <div key={`line-${idx}`} className="h-3 rounded bg-neutral-200" style={{ width: `${w}%` }} />
                    ))}
                  </div>
                  <div className="h-12 w-full rounded-xl bg-neutral-200" />
                  <div className="h-12 w-full rounded-xl bg-neutral-200" />
                  <div className="h-12 w-full rounded-xl bg-neutral-200" />
                </div>
              </div>
            </div>
          </section>
        ) : !currentItem ? (
          <Card className="py-14 text-center">
            <h1 className="text-2xl font-black text-[var(--foreground)]">Product not found</h1>
            <p className="mt-2 text-sm text-[var(--muted)]">
              This item is not available in the currently selected brand.
            </p>
            <Link href="/menu" className="mt-6 inline-flex rounded-lg bg-red-600 px-5 py-2 text-sm font-bold text-white">
              Back to menu
            </Link>
          </Card>
        ) : (
          <>
            <section
              className="rounded-2xl border bg-white p-3 shadow-sm sm:p-4 lg:p-6"
              style={{ borderColor: COLORS.line, backgroundColor: COLORS.bg }}
            >
              <nav className="mb-4 flex flex-wrap items-center gap-2 text-xs font-semibold text-[var(--muted)] sm:text-sm">
                <Link href="/" className="hover:text-[var(--foreground)]">Home</Link>
                <span className="text-neutral-400">{" > "}</span>
                <Link href="/menu" className="hover:text-[var(--foreground)]">
                  {selectedBrand?.name ?? "Menu"}
                </Link>
                <span className="text-neutral-400">{" > "}</span>
                <span className="text-[var(--foreground)]">{currentItem.name}</span>
              </nav>

              <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:gap-7">
                <motion.div
                  className="min-w-0 self-start lg:sticky lg:top-4"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <ProductImageGallery
                    key={currentItem.id}
                    itemName={currentItem.name}
                    imageUrl={currentItem.image_url}
                    galleryUrls={currentItem.gallery_image_urls}
                  />
                </motion.div>

                <div className="min-w-0 self-start rounded-2xl border bg-white p-4 sm:p-5 lg:p-6" style={{ borderColor: COLORS.line }}>
                  <div className="flex items-center gap-3">
                    <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full border border-red-200 bg-white sm:h-14 sm:w-14">
                      {selectedBrand?.logo_url ? (
                        <Image src={toImageUrl(selectedBrand.logo_url)} alt="" fill className="object-contain p-1" unoptimized />
                      ) : (
                        <span className="grid h-full w-full place-items-center text-sm font-black text-red-600 sm:text-base">
                          {(selectedBrand?.name ?? "F").slice(0, 1)}
                        </span>
                      )}
                    </div>
                    <p className="text-base font-bold text-[var(--foreground)] sm:text-lg">{selectedBrand?.name ?? "Foodies"}</p>
                  </div>

                  <h1 className="mt-2 text-xl font-black leading-tight tracking-tight text-[var(--foreground)] sm:mt-3 sm:text-2xl lg:text-[28px]">
                    {currentItem.name}
                  </h1>
                  <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted)] sm:text-sm">
                    {currentItem.description?.trim() || "A signature item crafted with bold flavors and quality ingredients."}
                  </p>

                  <p className={clsx("mt-3 sm:mt-4", PDP_PRICE_TEXT)}>
                    Starting From <span className="ml-1.5 sm:ml-2">Rs.{startingFrom.toFixed(0)}</span>
                  </p>

                  {availableOrderChannels.length ? (
                    <div className="mt-4">
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-[var(--muted)] sm:text-xs">
                        Available for
                      </p>
                      <ul
                        className="m-0 flex w-full list-none gap-2 p-0"
                        aria-label="Order types this product is available for"
                      >
                        {SERVICE_OPTIONS.filter((s) => availableOrderChannels.includes(s.id)).map((service) => (
                          <li
                            key={service.id}
                            className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-50 px-1.5 py-1.5 text-center text-[11px] font-semibold leading-tight text-neutral-700 sm:px-2 sm:py-2 sm:text-xs"
                          >
                            <span className="text-neutral-600" aria-hidden>
                              {iconNode(service.icon)}
                            </span>
                            {service.label}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {hasVariants ? (
                    <div className="mt-6">
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-[var(--muted)] sm:text-xs">
                        Select variant
                      </p>
                      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                        {variantsOrdered.map((variant) => {
                          const active = selectedVariantId === variant.id;
                          const total = currentItem.price + variant.price_modifier;
                          return (
                            <button
                              key={variant.id}
                              type="button"
                              aria-pressed={active}
                              onClick={() => updateSelection({ variantId: variant.id })}
                              className={clsx(
                                "min-w-0 flex-1 rounded-xl border px-3 py-2.5 text-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 sm:basis-[116px]",
                                active
                                  ? "border-red-600 bg-red-600 text-white shadow-sm"
                                  : "border-neutral-200 bg-white text-[var(--foreground)] hover:border-red-200",
                              )}
                            >
                              <span className="block truncate text-[14px] font-bold leading-tight">{variant.name}</span>
                              <span
                                className={clsx(
                                  "mt-0.5 block whitespace-nowrap text-[12px] font-bold tabular-nums leading-none",
                                  active ? "text-white/90" : "text-red-600",
                                )}
                              >
                                Rs.{total.toFixed(0)}
                                {variant.price_modifier !== 0 ? (
                                  <span className={clsx("ml-1 font-medium", active ? "text-white/70" : "text-[var(--muted)]")}>
                                    ({variant.price_modifier > 0 ? "+" : "-"}Rs.{Math.abs(variant.price_modifier).toFixed(0)})
                                  </span>
                                ) : null}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {categories.length ? (
                    <div className="mt-5 flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white sm:mt-6 sm:flex-row">
                      {/* Categories: a horizontal scroll strip on mobile, a vertical list on sm+. */}
                      <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-neutral-200 bg-neutral-50/70 p-2 [-ms-overflow-style:none] [scrollbar-width:none] sm:w-[182px] sm:flex-col sm:gap-1.5 sm:overflow-visible sm:border-b-0 sm:border-r sm:p-2.5 [&::-webkit-scrollbar]:hidden">
                        <div className="hidden items-center gap-1.5 px-0.5 pb-1.5 sm:flex">
                          <span className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-red-600 text-[11px] font-bold leading-none text-white">
                            1
                          </span>
                          <span className="text-[9.5px] font-bold uppercase tracking-wide text-neutral-500 sm:text-[10px]">
                            Tap a category
                          </span>
                        </div>
                        {categories.map((cat) => {
                          const isGroup = cat.kind === "group";
                          const min = isGroup ? resolveMinSelect(cat.group, sizeKey) : 0;
                          const catMax = isGroup ? resolveMaxSelect(cat.group, sizeKey) : null;
                          const count = isGroup
                            ? unitsInGroup(cat.group)
                            : selectedAddonIds.length;
                          const required = min > 0;
                          // A size switch can shrink the cap below what's already selected
                          // (XL 3 toppings → Large 2) — flag that as needing attention too.
                          const overMax = catMax != null && count > catMax;
                          const done = (!required || count >= min) && !overMax;
                          const hasSel = count > 0;
                          const complete = (required ? done : hasSel) && !overMax;
                          const name = shortCategoryName(isGroup ? cat.group.name : "Add-ons");
                          const sub = overMax
                            ? `Remove ${count - (catMax ?? 0)}`
                            : required
                              ? done
                                ? "Added"
                                : "Required"
                              : hasSel
                                ? `${count} added`
                                : "Optional";
                          const subColor = (required && !done) || overMax
                            ? "text-amber-600"
                            : hasSel
                              ? "text-emerald-600"
                              : "text-neutral-400";
                          const activeCat = activeCategoryKey === cat.key;
                          return (
                            <button
                              key={cat.key}
                              type="button"
                              aria-pressed={activeCat}
                              onClick={() => setActiveCategoryOverride(cat.key)}
                              className={clsx(
                                "flex shrink-0 items-center gap-1.5 rounded-lg border border-l-[3px] px-2 py-1.5 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 sm:w-full sm:gap-2 sm:py-2",
                                activeCat
                                  ? "border-red-200 border-l-red-600 bg-red-50 shadow-sm"
                                  : "border-neutral-200 border-l-neutral-200 bg-white hover:border-red-100",
                              )}
                            >
                              <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>
                                {complete ? (
                                  <svg viewBox="0 0 12 12" fill="none" className="h-3.5 w-3.5">
                                    <path d="M2.5 6.5 5 9l4.5-5.5" stroke="#16A34A" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                ) : (
                                  <span
                                    className={clsx(
                                      "block h-3 w-3 rounded-full border-[1.6px]",
                                      required ? "border-amber-400" : "border-neutral-300",
                                    )}
                                  />
                                )}
                              </span>
                              <span className="sm:min-w-0 sm:flex-1">
                                <span
                                  className={clsx(
                                    "block whitespace-nowrap text-[13px] font-bold leading-tight sm:overflow-hidden sm:text-ellipsis",
                                    activeCat ? "text-red-600" : "text-[var(--foreground)]",
                                  )}
                                >
                                  {name}
                                </span>
                                <span className={clsx("mt-0.5 block text-[11px] font-semibold leading-none", subColor)}>
                                  {sub}
                                </span>
                              </span>
                              <span className="hidden shrink-0 sm:inline-flex" aria-hidden>
                                {activeCat ? (
                                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-white">
                                    <svg viewBox="0 0 16 16" fill="none" className="h-2.5 w-2.5">
                                      <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                  </span>
                                ) : (
                                  <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 text-neutral-400">
                                    <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                )}
                              </span>
                            </button>
                          );
                        })}
                      </div>

                      <div className="min-w-0 flex-1 p-3 sm:p-4">
                        {activeCategory
                          ? (() => {
                              const isGroup = activeCategory.kind === "group";
                              const grp = isGroup ? activeCategory.group : null;
                              const min = grp ? resolveMinSelect(grp, sizeKey) : 0;
                              const maxResolved = grp ? resolveMaxSelect(grp, sizeKey) : null;
                              const max = maxResolved ?? 99;
                              const single = isGroup ? max === 1 : false;
                              const count = grp ? unitsInGroup(grp) : selectedAddonIds.length;
                              const helper = !isGroup
                                ? "Add any"
                                : single
                                  ? "Choose 1"
                                  : min > 0
                                    ? `Choose at least ${min}`
                                    : maxResolved == null || max >= 99
                                      ? "Add any"
                                      : `Up to ${max}`;
                              const title = shortCategoryName(isGroup ? grp!.name : "Add-ons");
                              const hasTiers = !!(grp?.price_tiers && Object.keys(grp.price_tiers).length > 0);
                              // First-N-free allowance (size-aware), per UNIT and cheapest-first — the exact
                              // rule the POS configurator and the backend pricing use.
                              const includedFree = grp
                                ? sizeKey && grp.included_by_size && grp.included_by_size[sizeKey] != null
                                  ? Number(grp.included_by_size[sizeKey])
                                  : grp.included_quantity ?? 0
                                : 0;
                              const freeUnitsByMod = new Map<number, number>();
                              let freeRemaining = includedFree;
                              if (grp && includedFree > 0) {
                                const sel = (grp.modifiers ?? [])
                                  .filter((m) => effectiveSelectedModifierIds.includes(m.id))
                                  .map((m) => ({ id: m.id, qty: quantityOf(m.id), unit: resolveModifierUnitPrice(m, sizeKey) }))
                                  .sort((a, b) => a.unit - b.unit);
                                const maxQty = sel.reduce((mx, s) => Math.max(mx, s.qty), 0);
                                outer: for (let slot = 0; slot < maxQty; slot++) {
                                  for (const s of sel) {
                                    if (freeRemaining <= 0) break outer;
                                    if (s.qty <= slot) continue;
                                    freeUnitsByMod.set(s.id, (freeUnitsByMod.get(s.id) ?? 0) + 1);
                                    freeRemaining--;
                                  }
                                }
                              }
                              return (
                                <>
                                  <p className="text-[10px] font-bold uppercase tracking-wide text-red-600 sm:text-[10.5px]">
                                    2 · Options for
                                  </p>
                                  <div className="mb-3 mt-0.5 flex flex-wrap items-baseline gap-x-2">
                                    <span className="text-[16px] font-bold leading-tight text-[var(--foreground)] sm:text-[17px]">
                                      {title}
                                    </span>
                                    <span className="text-[12px] font-medium text-neutral-400">{helper}</span>
                                  </div>
                                  {hasTiers ? (
                                    <div className="mb-2.5 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-[12px] font-medium text-emerald-700">
                                      {includedFree > 0 ? `First ${includedFree} free · ` : ""}Extra: {formatTiers(grp!.price_tiers ?? {})}
                                    </div>
                                  ) : includedFree > 0 ? (
                                    <div className="mb-2.5 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-[12px] font-medium text-emerald-700">
                                      First {includedFree} free — extras charged at the price shown.
                                    </div>
                                  ) : null}
                                  <div className="max-h-[18rem] space-y-1.5 overflow-y-auto pr-0.5 [scrollbar-width:thin]">
                                    {isGroup
                                      ? sortModifiersByOrder(grp!.modifiers ?? [])
                                          .filter((mod) => isModAvailableForSize(mod, sizeKey))
                                          .map((mod) => {
                                          const active = selectedModifierIds.includes(mod.id);
                                          const atMax = !single && max < 99 && count >= max && !active;
                                          const unit = resolveModifierUnitPrice(mod, sizeKey);
                                          const qty = active ? quantityOf(mod.id) : 0;
                                          const freeUnits = freeUnitsByMod.get(mod.id) ?? 0;
                                          // Price label — identical rules to the POS ItemConfigModal.
                                          let priceLabel: string | null;
                                          let charged = false;
                                          if (unit <= 0) {
                                            priceLabel = hasTiers ? null : min > 0 ? "Included" : "Free";
                                          } else if (active) {
                                            const chargedUnits = qty - freeUnits;
                                            if (chargedUnits <= 0) {
                                              priceLabel = "Included";
                                            } else {
                                              priceLabel = `+ Rs.${(unit * chargedUnits).toFixed(0)}`;
                                              charged = true;
                                            }
                                          } else if (freeRemaining > 0) {
                                            priceLabel = "Free";
                                          } else {
                                            priceLabel = `+ Rs.${unit.toFixed(0)}`;
                                            charged = true;
                                          }
                                          const canRepeat =
                                            active && !single && (unit > 0 || includedFree > 0 || min > 0 || !!grp!.allow_quantity);
                                          return (
                                            <div
                                              key={mod.id}
                                              className={clsx(
                                                "flex items-center gap-2 rounded-lg border px-3 py-2 transition",
                                                active ? "border-red-600 bg-red-50" : "border-neutral-200 bg-white",
                                                atMax && "border-neutral-200 bg-neutral-50 opacity-60",
                                              )}
                                            >
                                              <button
                                                type="button"
                                                disabled={atMax}
                                                aria-pressed={active}
                                                onClick={() => toggleModifier(grp!, mod.id)}
                                                className={clsx(
                                                  "flex min-w-0 flex-1 items-center gap-2.5 rounded-md py-0.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500",
                                                  atMax && "cursor-not-allowed",
                                                )}
                                              >
                                                <span
                                                  className={clsx(
                                                    "inline-flex h-5 w-5 shrink-0 items-center justify-center border-[1.6px] text-white",
                                                    single ? "rounded-full" : "rounded-md",
                                                    active ? "border-red-600 bg-red-600" : "border-neutral-300 bg-white text-transparent",
                                                  )}
                                                >
                                                  {CHECK_ICON}
                                                </span>
                                                <span
                                                  className={clsx(
                                                    "min-w-0 flex-1 truncate text-[14px] font-semibold",
                                                    active ? "text-red-600" : "text-[var(--foreground)]",
                                                  )}
                                                >
                                                  {mod.name}
                                                </span>
                                                {priceLabel ? (
                                                  <span
                                                    className={clsx(
                                                      "shrink-0 text-[13px] font-bold tabular-nums leading-none",
                                                      charged ? "text-neutral-600" : "text-emerald-600",
                                                    )}
                                                  >
                                                    {priceLabel}
                                                  </span>
                                                ) : null}
                                              </button>
                                              {canRepeat ? (
                                                <div className="inline-flex shrink-0 items-center overflow-hidden rounded-lg border border-neutral-300 bg-white">
                                                  <button
                                                    type="button"
                                                    aria-label={`Decrease ${mod.name}`}
                                                    onClick={() => setModifierQuantity(grp!, mod.id, qty - 1)}
                                                    className="px-2 py-1 text-neutral-600 transition hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                                                  >
                                                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
                                                      <path d="M5 12h14" strokeLinecap="round" />
                                                    </svg>
                                                  </button>
                                                  <span className="min-w-[1.75rem] px-0.5 text-center text-[13px] font-bold tabular-nums">{qty}</span>
                                                  <button
                                                    type="button"
                                                    aria-label={`Increase ${mod.name}`}
                                                    disabled={!single && max < 99 && count >= max}
                                                    onClick={() => setModifierQuantity(grp!, mod.id, qty + 1)}
                                                    className="px-2 py-1 text-neutral-600 transition hover:bg-neutral-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:cursor-not-allowed disabled:opacity-40"
                                                  >
                                                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
                                                      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                                                    </svg>
                                                  </button>
                                                </div>
                                              ) : null}
                                            </div>
                                          );
                                        })
                                      : addonsOrdered.map((addon) => {
                                          const active = selectedAddonIds.includes(addon.id);
                                          return (
                                            <button
                                              key={addon.id}
                                              type="button"
                                              aria-pressed={active}
                                              onClick={() => toggleAddon(addon.id)}
                                              className={clsx(
                                                "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500",
                                                active ? "border-red-600 bg-red-50" : "border-neutral-200 bg-white hover:border-neutral-300",
                                              )}
                                            >
                                              <span
                                                className={clsx(
                                                  "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-[1.6px] text-white",
                                                  active ? "border-red-600 bg-red-600" : "border-neutral-300 bg-white text-transparent",
                                                )}
                                              >
                                                {CHECK_ICON}
                                              </span>
                                              <span
                                                className={clsx(
                                                  "min-w-0 flex-1 truncate text-[14px] font-semibold",
                                                  active ? "text-red-600" : "text-[var(--foreground)]",
                                                )}
                                              >
                                                {addon.name}
                                              </span>
                                              <span
                                                className={clsx(
                                                  "shrink-0 text-[13px] font-bold tabular-nums leading-none",
                                                  active ? "text-red-600" : addon.price > 0 ? "text-neutral-600" : "text-emerald-600",
                                                )}
                                              >
                                                {addon.price > 0 ? `+ Rs.${addon.price.toFixed(0)}` : "Free"}
                                              </span>
                                            </button>
                                          );
                                        })}
                                  </div>
                                </>
                              );
                            })()
                          : null}
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-5 flex flex-col gap-3 border-t border-neutral-200 pt-4 sm:mt-6 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">Total</p>
                      <p className="text-2xl font-black tabular-nums leading-tight text-red-600">
                        Rs.{selectedPrice.toFixed(0)}
                      </p>
                    </div>
                    <div className="flex flex-col items-stretch gap-1.5 sm:items-end">
                      <Link
                        href="/order-info"
                        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-black px-5 py-3 text-[13px] font-black uppercase tracking-wide !text-white transition hover:bg-neutral-900 sm:w-auto sm:text-sm"
                      >
                        <svg className="h-4 w-4 shrink-0 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                          <rect x="7" y="2.5" width="10" height="19" rx="2" />
                          <path d="M10 18h4" />
                        </svg>
                        {orderRedirectConfig.ctaLabel}
                      </Link>
                      <p className="text-center text-[12px] text-[var(--muted)] sm:text-right">
                        Ordering is currently available on our mobile app.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {relatedProducts.length ? (
              <section className="mt-6 rounded-2xl border bg-white p-4 shadow-sm sm:p-5" style={{ borderColor: COLORS.line }}>
                <div className="mb-3 flex items-center justify-between gap-3 sm:mb-4">
                  <h2 className="text-lg font-black text-[var(--foreground)] sm:text-xl">You May Also Like</h2>
                  <Link
                    href="/menu"
                    className="inline-flex items-center gap-2 text-xs font-bold text-red-600 hover:underline sm:text-sm"
                  >
                    View All
                    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-red-200 bg-white text-red-600">
                      {ICON_CHEVRON_RIGHT_SM}
                    </span>
                  </Link>
                </div>

                <div className="flex gap-3 overflow-x-auto pb-1 sm:grid sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
                  {relatedProducts.slice(0, 3).map((product) => (
                    <article
                      key={product.id}
                      className="w-[260px] shrink-0 overflow-hidden rounded-xl border bg-white sm:w-auto"
                      style={{ borderColor: COLORS.line }}
                    >
                      <Link href={`/menu/${product.id}`} className="block">
                        <div className="relative aspect-[4/3] bg-neutral-100">
                          <Image
                            src={
                              product.image_url
                                ? menuImageUrl(toImageUrl(product.image_url), "thumb")
                                : MENU_ITEM_PLACEHOLDER(product.name)
                            }
                            alt={product.name}
                            fill
                            unoptimized={shouldUnoptimizeImage(
                              product.image_url
                                ? menuImageUrl(toImageUrl(product.image_url), "thumb")
                                : MENU_ITEM_PLACEHOLDER(product.name),
                            )}
                            loading="lazy"
                            className={product.image_url ? "object-cover" : "object-contain"}
                            sizes="(max-width: 640px) 80vw, (max-width: 1024px) 50vw, 33vw"
                          />
                        </div>
                      </Link>

                      <div className="space-y-2 p-3.5">
                        <Link href={`/menu/${product.id}`} className="block">
                          <h3 className="line-clamp-1 text-sm font-bold text-[var(--foreground)] sm:text-base">{product.name}</h3>
                          <p className="line-clamp-2 min-h-[36px] text-xs leading-snug text-[var(--muted)] sm:min-h-[40px] sm:text-sm">
                            {product.description?.trim() || "Deliciously prepared for a satisfying meal."}
                          </p>
                        </Link>
                        <div className="flex items-center justify-between">
                          <p className={PDP_PRICE_TEXT}>Rs.{product.price.toFixed(0)}</p>
                          <Link
                            href={`/menu/${product.id}`}
                            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-neutral-300 bg-white text-[var(--foreground)] transition hover:bg-neutral-100"
                            aria-label={`Open ${product.name}`}
                          >
                            {ICON_PLUS_SM}
                          </Link>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )}

        <SiteFooter />
      </div>
    </AppShell>
  );
}

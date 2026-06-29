"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
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
import { computeModifiersPrice, sizeKeyForVariant } from "@/lib/modifier-pricing";

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
function buildDefaultModifierIds(groups: ModifierGroup[]): number[] {
  const ids: number[] = [];
  for (const g of groups) {
    const min = Math.max(0, Math.floor(g.min_select ?? 0));
    const mods = g.modifiers ?? [];
    if (min === 0 || !mods.length) continue;
    const take = Math.min(min, mods.length);
    for (let i = 0; i < take; i++) {
      ids.push(mods[i]!.id);
    }
  }
  return ids;
}

function countSelectedInGroup(group: ModifierGroup, selectedIds: number[]): number {
  const ids = new Set((group.modifiers ?? []).map((m) => m.id));
  return selectedIds.filter((id) => ids.has(id)).length;
}

/** Same pattern as POS `ItemConfigModal`: "(choose min–max)" with "+" when max is open-ended */
function groupChooseTitle(group: ModifierGroup): string {
  const min = group.min_select ?? 0;
  const max = group.max_select;
  const maxStr = max != null ? `–${max}` : "+";
  return `${group.name} (choose ${min}${maxStr})`;
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

function sortModifiersById(modifiers: Modifier[]): Modifier[] {
  return [...modifiers].sort((a, b) => a.id - b.id);
}

type SectionStatus = "complete" | "required-missing" | "optional-empty";

function SectionStatusBadge({ status }: { status: SectionStatus }) {
  const meta: Record<SectionStatus, { icon: string; label: string; className: string }> = {
    complete: {
      icon: "✓",
      label: "Selected",
      className: "bg-emerald-100 text-emerald-700",
    },
    "required-missing": {
      icon: "!",
      label: "Required",
      className: "bg-amber-100 text-amber-800",
    },
    "optional-empty": {
      icon: "—",
      label: "Optional",
      className: "bg-neutral-100 text-neutral-600",
    },
  };
  const m = meta[status];
  return (
    <span
      className={clsx(
        "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold leading-none",
        m.className,
      )}
      title={m.label}
      aria-label={m.label}
    >
      {m.icon}
    </span>
  );
}

/** POS-style collapsible row + animated body. Remount via parent `key` when product or default open section changes. */
function PdpAccordion({
  title,
  status,
  defaultOpen,
  children,
}: {
  title: string;
  status?: SectionStatus;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      className={clsx(
        "border-b border-neutral-200 last:border-b-0",
        open && "border-l-2 border-l-red-600 pl-2 bg-red-50/30",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-1 py-2.5 text-left transition hover:bg-neutral-50/80"
        aria-expanded={open}
      >
        <span className="flex min-w-0 items-center gap-2">
          {status != null ? <SectionStatusBadge status={status} /> : null}
          <span className="truncate text-[13px] font-semibold text-[var(--foreground)] sm:text-sm">{title}</span>
        </span>
        <motion.span
          className="inline-flex shrink-0 text-red-600"
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ type: "tween", duration: 0.2 }}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "tween", duration: 0.22 }}
            className="overflow-hidden"
          >
            <div className="pb-3 pl-1 pr-1 pt-0">{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

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
    Record<number, { variantId: number | null; modifierIds: number[]; addonIds: number[] }>
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
    () => buildDefaultModifierIds(modifierGroupsOrdered),
    [modifierGroupsOrdered],
  );

  const defaultSelection = useMemo(
    () => ({
      variantId: defaultVariant?.id ?? null,
      modifierIds: defaultModifierIds,
      addonIds: [] as number[],
    }),
    [defaultModifierIds, defaultVariant?.id],
  );

  const currentSelection = currentItem
    ? (selectionByItemId[currentItem.id] ?? defaultSelection)
    : null;
  const selectedVariantId = currentSelection?.variantId ?? null;
  const selectedModifierIds = currentSelection?.modifierIds ?? EMPTY_NUMBER_ARRAY;
  const selectedAddonIds = currentSelection?.addonIds ?? EMPTY_NUMBER_ARRAY;

  const selectedVariant = useMemo(() => {
    if (!currentItem || selectedVariantId == null) return null;
    return variantsOrdered.find((v) => v.id === selectedVariantId) ?? null;
  }, [currentItem, selectedVariantId, variantsOrdered]);

  const modifierPriceTotal = useMemo(() => {
    if (!currentItem) return 0;
    const groups = currentItem.modifier_groups ?? [];
    const uniqueIds = Array.from(new Set(selectedModifierIds));
    return computeModifiersPrice(
      groups,
      uniqueIds.map((id) => ({ modifier_id: id, quantity: 1 })),
      sizeKeyForVariant(selectedVariant),
    );
  }, [currentItem, selectedModifierIds, selectedVariant]);

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
    next: Partial<{ variantId: number | null; modifierIds: number[]; addonIds: number[] }>,
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
    const modsInGroup = new Set((group.modifiers ?? []).map((m) => m.id));
    const selectedInGroup = selected.filter((id) => modsInGroup.has(id));
    const isSelected = selected.includes(modifierId);
    const maxSel = group.max_select ?? 99;
    const minSel = group.min_select ?? 0;

    if (maxSel === 1) {
      if (isSelected) {
        if (minSel === 0) {
          updateSelection({ modifierIds: selected.filter((id) => id !== modifierId) });
        }
        return;
      }
      const rest = selected.filter((id) => !modsInGroup.has(id));
      updateSelection({ modifierIds: [...rest, modifierId] });
      return;
    }

    if (isSelected) {
      if (selectedInGroup.length <= minSel) return;
      updateSelection({ modifierIds: selected.filter((id) => id !== modifierId) });
      return;
    }
    if (selectedInGroup.length >= maxSel) return;
    updateSelection({ modifierIds: [...selected, modifierId] });
  };

  const toggleAddon = (addonId: number) => {
    const nextAddons = selectedAddonIds.includes(addonId)
      ? selectedAddonIds.filter((id) => id !== addonId)
      : [...selectedAddonIds, addonId];
    updateSelection({ addonIds: nextAddons });
  };

  const modifierGroupsFiltered = modifierGroupsOrdered;
  const hasVariants = variantsOrdered.length > 0;
  const hasModifierGroups = modifierGroupsFiltered.length > 0;
  const hasAddons = addonsOrdered.length > 0;

  const variantSectionStatus = useMemo((): SectionStatus | undefined => {
    if (!variantsOrdered.length) return undefined;
    return selectedVariantId != null ? "complete" : "required-missing";
  }, [variantsOrdered.length, selectedVariantId]);

  const modifierOuterStatus = useMemo((): SectionStatus | undefined => {
    if (!modifierGroupsFiltered.length) return undefined;
    const anyRequiredMissing = modifierGroupsFiltered.some((g) => {
      const min = g.min_select ?? 0;
      if (min === 0) return false;
      return countSelectedInGroup(g, selectedModifierIds) < min;
    });
    return anyRequiredMissing ? "required-missing" : "complete";
  }, [modifierGroupsFiltered, selectedModifierIds]);

  const addonSectionStatus = useMemo((): SectionStatus | undefined => {
    if (!addonsOrdered.length) return undefined;
    return selectedAddonIds.length > 0 ? "complete" : "optional-empty";
  }, [addonsOrdered.length, selectedAddonIds]);

  const accordionDefaults = useMemo(() => {
    if (!currentItem) {
      return { variants: true, modifiers: true, addons: true };
    }
    const hv = variantsOrdered.length > 0;
    const hm = modifierGroupsFiltered.length > 0;
    return {
      variants: true,
      modifiers: !hv,
      addons: !hv && !hm,
    };
  }, [currentItem, modifierGroupsFiltered, variantsOrdered.length]);

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

                  {hasVariants || hasModifierGroups || hasAddons ? (
                    <div className="mt-6 overflow-hidden rounded-xl border border-neutral-200 bg-[var(--surface)] px-2 sm:px-3">
                      {hasVariants ? (
                        <PdpAccordion
                          key={`${currentItem.id}-variants`}
                          title="Select variant"
                          status={variantSectionStatus}
                          defaultOpen={accordionDefaults.variants}
                        >
                          <div className="space-y-2">
                            {variantsOrdered.map((variant) => {
                              const active = selectedVariantId === variant.id;
                              return (
                                <button
                                  key={variant.id}
                                  type="button"
                                  onClick={() => updateSelection({ variantId: variant.id })}
                                  className={clsx(
                                    "flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition sm:px-4 sm:py-3",
                                    active ? "border-red-500 bg-white" : "border-neutral-200 bg-neutral-50 hover:bg-white",
                                  )}
                                >
                                  <span className="flex items-center gap-3">
                                    <span
                                      className={clsx(
                                        "inline-flex h-5 w-5 items-center justify-center rounded-full border text-white",
                                        active ? "border-red-600 bg-red-600" : "border-neutral-400 bg-white text-transparent",
                                      )}
                                    >
                                      {CHECK_ICON}
                                    </span>
                                    <span>
                                      <span className="block text-sm font-bold leading-tight text-[var(--foreground)] sm:text-[15px]">
                                        {variant.name}
                                      </span>
                                      <span className="block text-base font-bold tabular-nums leading-none text-[var(--muted)]">
                                        {variant.price_modifier >= 0 ? "+" : "-"} Rs.
                                        {Math.abs(variant.price_modifier).toFixed(0)}
                                      </span>
                                    </span>
                                  </span>
                                  <span className={PDP_PRICE_TEXT}>
                                    Rs.{(currentItem.price + variant.price_modifier).toFixed(0)}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </PdpAccordion>
                      ) : null}

                      {hasModifierGroups ? (
                        <PdpAccordion
                          key={`${currentItem.id}-modifiers`}
                          title="Modifiers"
                          status={modifierOuterStatus}
                          defaultOpen={accordionDefaults.modifiers}
                        >
                          <div className="max-h-64 space-y-1 overflow-y-auto pr-0.5 [-ms-overflow-style:auto] [scrollbar-width:thin]">
                            {modifierGroupsFiltered.map((group, groupIndex) => {
                              const minSelect = group.min_select ?? 0;
                              const count = countSelectedInGroup(group, selectedModifierIds);
                              const minOk = count >= minSelect;
                              const maxOne = (group.max_select ?? 99) === 1;
                              const groupStatus: SectionStatus = minOk
                                ? "complete"
                                : minSelect > 0
                                  ? "required-missing"
                                  : "optional-empty";

                              return (
                                <PdpAccordion
                                  key={`${currentItem.id}-mod-g-${group.id}`}
                                  title={groupChooseTitle(group)}
                                  status={groupStatus}
                                  defaultOpen={groupIndex === 0}
                                >
                                  {!minOk && minSelect > 0 ? (
                                    <p className="mb-2 text-xs text-amber-700">
                                      Select at least {minSelect}.
                                    </p>
                                  ) : null}
                                  {maxOne ? (
                                    <div className="flex flex-wrap gap-2">
                                      {sortModifiersById(group.modifiers ?? []).map((mod) => {
                                        const active = selectedModifierIds.includes(mod.id);
                                        return (
                                          <button
                                            key={mod.id}
                                            type="button"
                                            onClick={() => toggleModifier(group, mod.id)}
                                            className={clsx(
                                              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition sm:px-3.5 sm:py-2 sm:text-[13px]",
                                              active
                                                ? "border-red-600 bg-red-600 text-white"
                                                : "border-neutral-200 bg-white text-[var(--foreground)] hover:bg-neutral-100",
                                            )}
                                          >
                                            {active ? (
                                              <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/20 text-white">
                                                {CHECK_ICON}
                                              </span>
                                            ) : null}
                                            <span>{mod.name}</span>
                                            <span
                                              className={clsx(
                                                "text-base font-bold tabular-nums leading-none",
                                                active ? "text-white" : "text-red-600",
                                              )}
                                            >
                                              {mod.price >= 0 ? "+" : "-"}Rs.{Math.abs(mod.price).toFixed(0)}
                                            </span>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  ) : (
                                    <div className="space-y-2">
                                      {sortModifiersById(group.modifiers ?? []).map((mod) => {
                                        const active = selectedModifierIds.includes(mod.id);
                                        return (
                                          <button
                                            key={mod.id}
                                            type="button"
                                            onClick={() => toggleModifier(group, mod.id)}
                                            className={clsx(
                                              "flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition sm:px-4 sm:py-3",
                                              active ? "border-red-300 bg-red-50" : "border-neutral-200 bg-white hover:bg-neutral-50",
                                            )}
                                          >
                                            <span className="flex items-center gap-3">
                                              <span
                                                className={clsx(
                                                  "inline-flex h-5 w-5 items-center justify-center rounded border text-white",
                                                  active ? "border-red-600 bg-red-600" : "border-neutral-400 bg-white text-transparent",
                                                )}
                                              >
                                                {CHECK_ICON}
                                              </span>
                                              <span className="text-sm font-semibold text-[var(--foreground)] sm:text-[15px]">
                                                {mod.name}
                                              </span>
                                            </span>
                                            <span className={PDP_PRICE_TEXT}>
                                              {mod.price >= 0 ? "+" : "-"} Rs.{Math.abs(mod.price).toFixed(0)}
                                            </span>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                </PdpAccordion>
                              );
                            })}
                          </div>
                        </PdpAccordion>
                      ) : null}

                      {hasAddons ? (
                        <PdpAccordion
                          key={`${currentItem.id}-addons`}
                          title="Add-ons"
                          status={addonSectionStatus}
                          defaultOpen={accordionDefaults.addons}
                        >
                          <div className="max-h-64 space-y-2 overflow-y-auto pr-0.5 [-ms-overflow-style:auto] [scrollbar-width:thin]">
                            {addonsOrdered.map((addon) => {
                              const active = selectedAddonIds.includes(addon.id);
                              return (
                                <button
                                  key={addon.id}
                                  type="button"
                                  onClick={() => toggleAddon(addon.id)}
                                  className={clsx(
                                    "flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition sm:px-4 sm:py-3",
                                    active ? "border-red-300 bg-red-50" : "border-neutral-200 bg-white hover:bg-neutral-50",
                                  )}
                                >
                                  <span className="flex items-center gap-3">
                                    <span
                                      className={clsx(
                                        "inline-flex h-5 w-5 items-center justify-center rounded border text-white",
                                        active ? "border-red-600 bg-red-600" : "border-neutral-400 bg-white text-transparent",
                                      )}
                                    >
                                      {CHECK_ICON}
                                    </span>
                                    <span className="text-sm font-semibold text-[var(--foreground)] sm:text-[15px]">
                                      {addon.name}
                                    </span>
                                  </span>
                                  <span className={PDP_PRICE_TEXT}>
                                    + Rs.{addon.price.toFixed(0)}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </PdpAccordion>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="mt-5 rounded-xl border border-neutral-200 bg-neutral-50 p-3 sm:mt-6 sm:p-4">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)] sm:text-xs">Selected price</p>
                    <p className={clsx("mt-0.5", PDP_PRICE_TEXT)}>Rs.{selectedPrice.toFixed(0)}</p>
                  </div>

                  <Link
                    href="/order-info"
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-black px-4 py-2.5 text-xs font-black uppercase tracking-wide !text-white transition hover:bg-neutral-900 sm:mt-5 sm:py-3 sm:text-sm"
                  >
                    <svg className="h-4 w-4 shrink-0 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <rect x="7" y="2.5" width="10" height="19" rx="2" />
                      <path d="M10 18h4" />
                    </svg>
                    {orderRedirectConfig.ctaLabel}
                  </Link>
                  <p className="mt-2 text-center text-xs text-[var(--muted)]">
                    Ordering is currently available on our mobile app.
                  </p>
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

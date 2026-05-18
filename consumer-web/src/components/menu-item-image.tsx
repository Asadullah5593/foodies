"use client";

import Image, { type ImageProps } from "next/image";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { shouldUnoptimizeImage } from "@/lib/media-image";
import { useMenuImageLoaded } from "@/lib/use-menu-image-loaded";

type MenuItemImageProps = Omit<ImageProps, "src" | "onLoad" | "onError"> & {
  src: string;
  /** Canonical URL if variant `src` fails (e.g. missing _w320 on S3). */
  fallbackSrc?: string;
  skeletonClassName?: string;
};

export function MenuItemImage({
  src,
  fallbackSrc,
  className,
  skeletonClassName,
  alt = "",
  ...props
}: MenuItemImageProps) {
  const [currentSrc, setCurrentSrc] = useState(src);
  const isPlaceholder = currentSrc.startsWith("data:");
  const { loaded, markLoaded, imgRef } = useMenuImageLoaded(currentSrc, isPlaceholder);

  useEffect(() => {
    setCurrentSrc(src);
  }, [src]);

  return (
    <>
      {!loaded ? (
        <div
          className={clsx("absolute inset-0 z-10 animate-pulse bg-neutral-200", skeletonClassName)}
          aria-hidden
        />
      ) : null}
      <Image
        {...props}
        ref={imgRef}
        src={currentSrc}
        alt={alt}
        unoptimized={shouldUnoptimizeImage(currentSrc)}
        className={className}
        onLoad={markLoaded}
        onError={() => {
          if (fallbackSrc && currentSrc !== fallbackSrc) {
            setCurrentSrc(fallbackSrc);
          } else {
            markLoaded();
          }
        }}
      />
    </>
  );
}

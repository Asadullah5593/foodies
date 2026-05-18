import { useCallback, useState } from "react";

/**
 * Tracks image load for menu photos. Handles browser cache where `onLoad` may not fire
 * after client-side navigation.
 */
export function useMenuImageLoaded(src: string, isPlaceholder = false) {
  const [loaded, setLoaded] = useState(isPlaceholder);
  const [prevSrc, setPrevSrc] = useState(src);
  const [prevPlaceholder, setPrevPlaceholder] = useState(isPlaceholder);

  if (prevSrc !== src || prevPlaceholder !== isPlaceholder) {
    setPrevSrc(src);
    setPrevPlaceholder(isPlaceholder);
    setLoaded(isPlaceholder);
  }

  const markLoaded = useCallback(() => setLoaded(true), []);

  const imgRef = useCallback((node: HTMLImageElement | null) => {
    if (node?.complete && node.naturalWidth > 0) {
      setLoaded(true);
    }
  }, []);

  return { loaded, markLoaded, imgRef };
}

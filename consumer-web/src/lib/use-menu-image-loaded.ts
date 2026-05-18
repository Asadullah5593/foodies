import { useCallback, useEffect, useState } from "react";

/**
 * Tracks image load for menu photos. Handles browser cache where `onLoad` may not fire
 * after client-side navigation.
 */
export function useMenuImageLoaded(src: string, isPlaceholder = false) {
  const [loaded, setLoaded] = useState(isPlaceholder);

  useEffect(() => {
    setLoaded(isPlaceholder);
  }, [src, isPlaceholder]);

  const markLoaded = useCallback(() => setLoaded(true), []);

  const imgRef = useCallback(
    (node: HTMLImageElement | null) => {
      if (node?.complete && node.naturalWidth > 0) {
        setLoaded(true);
      }
    },
    [src],
  );

  return { loaded, markLoaded, imgRef };
}

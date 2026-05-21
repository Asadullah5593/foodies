"use client";

import { useCallback, useEffect, useState } from "react";

const COMING_SOON_VIDEO =
  "/Food_Delivery_Landing_A_man_in_a_grey_suit_stands_in_a_dimly_lit_room_TBovm0FN.mp4";

function getViewportSize() {
  if (typeof window === "undefined") return { w: 0, h: 0 };
  return { w: window.innerWidth, h: window.innerHeight };
}

export function ComingSoonVideo() {
  const [aspect, setAspect] = useState({ w: 16, h: 9 });
  const [viewport, setViewport] = useState(getViewportSize);

  useEffect(() => {
    const onResize = () => setViewport(getViewportSize());
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onMetadata = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget;
    if (v.videoWidth > 0 && v.videoHeight > 0) {
      setAspect({ w: v.videoWidth, h: v.videoHeight });
    }
  }, []);

  const videoAr = aspect.w / aspect.h;
  const viewportAr =
    viewport.w > 0 && viewport.h > 0 ? viewport.w / viewport.h : videoAr;
  const isCover = viewportAr >= videoAr;

  return (
    <main
      className="coming-soon-stage"
      style={
        {
          "--ar-w": aspect.w,
          "--ar-h": aspect.h,
        } as React.CSSProperties
      }
    >
      <div
        className={
          isCover ? "coming-soon-video-frame coming-soon-video-frame--cover" : "coming-soon-video-frame"
        }
      >
        <video
          src={COMING_SOON_VIDEO}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          onLoadedMetadata={onMetadata}
          aria-label="Foodies — coming soon"
        />
      </div>
    </main>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Desktop / tablet / phone landscape — web view (unchanged) */
const DESKTOP_VIDEO =
  "/Food_Delivery_Landing_A_man_in_a_grey_suit_stands_in_a_dimly_lit_room_TBovm0FN.mp4";

/** Mobile portrait only */
const MOBILE_PORTRAIT_VIDEO = "/Food_Delivery_Landing_Potrait.mp4";

const MOBILE_PORTRAIT_QUERY = "(max-width: 768px) and (orientation: portrait)";

function readViewportSize() {
  if (typeof window === "undefined") {
    return { w: 0, h: 0 };
  }
  const vv = window.visualViewport;
  return {
    w: Math.round(vv?.width ?? window.innerWidth),
    h: Math.round(vv?.height ?? window.innerHeight),
  };
}

export function ComingSoonVideo() {
  const desktopRef = useRef<HTMLVideoElement>(null);
  const mobileRef = useRef<HTMLVideoElement>(null);
  const [aspect, setAspect] = useState({ w: 16, h: 9 });
  const [viewport, setViewport] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_PORTRAIT_QUERY);

    const syncPlayback = () => {
      const mobile = mq.matches;
      if (mobile) {
        desktopRef.current?.pause();
        void mobileRef.current?.play().catch(() => {});
      } else {
        mobileRef.current?.pause();
        void desktopRef.current?.play().catch(() => {});
      }
    };

    const update = () => {
      const next = readViewportSize();
      setViewport((prev) =>
        prev.w === next.w && prev.h === next.h ? prev : next,
      );
      syncPlayback();
    };

    mq.addEventListener("change", syncPlayback);
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    window.visualViewport?.addEventListener("resize", update);

    return () => {
      mq.removeEventListener("change", syncPlayback);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);

  const onDesktopMetadata = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      const v = e.currentTarget;
      if (v.videoWidth > 0 && v.videoHeight > 0) {
        setAspect({ w: v.videoWidth, h: v.videoHeight });
      }
    },
    [],
  );

  const videoAr = aspect.w / aspect.h;
  const viewportAr =
    viewport.w > 0 && viewport.h > 0 ? viewport.w / viewport.h : videoAr;
  const isCover = viewportAr >= videoAr;

  return (
    <main className="coming-soon-stage">
      {/* Always in DOM (SSR + client match) — hidden on phone portrait via CSS */}
      <div
        className={
          isCover
            ? "coming-soon-video-desktop coming-soon-video-frame coming-soon-video-frame--cover"
            : "coming-soon-video-desktop coming-soon-video-frame coming-soon-video-frame--contain"
        }
        style={
          {
            "--ar-w": aspect.w,
            "--ar-h": aspect.h,
          } as React.CSSProperties
        }
      >
        <video
          ref={desktopRef}
          src={DESKTOP_VIDEO}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          onLoadedMetadata={onDesktopMetadata}
          aria-label="Foodies — coming soon"
        />
      </div>

      {/* Portrait MP4 — visible on phone portrait only via CSS */}
      <div className="coming-soon-video-mobile">
        <video
          ref={mobileRef}
          src={MOBILE_PORTRAIT_VIDEO}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          aria-label="Foodies — coming soon"
        />
      </div>
    </main>
  );
}

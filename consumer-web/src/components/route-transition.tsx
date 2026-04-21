"use client";

import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export function RouteTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const firstRenderRef = useRef(true);

  const [splashVisible, setSplashVisible] = useState(false);

  useEffect(() => {
    // Avoid splash on initial page load.
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }

    let hideTimer: number | undefined;
    const raf = requestAnimationFrame(() => {
      setSplashVisible(true);
      hideTimer = window.setTimeout(() => {
        setSplashVisible(false);
      }, 1900);
    });

    return () => {
      cancelAnimationFrame(raf);
      if (hideTimer !== undefined) window.clearTimeout(hideTimer);
    };
  }, [pathname]);

  return (
    <>
      <AnimatePresence mode="wait">
        <motion.div
          key={pathname}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.22, ease: "easeInOut" }}
        >
          {children}
        </motion.div>
      </AnimatePresence>

      <AnimatePresence>
        {splashVisible ? (
          <motion.div
            key={`splash-${pathname}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeInOut" }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 backdrop-blur-sm"
          >
            <div className="flex flex-col items-center gap-4">
              <div className="relative h-14 w-14">
                <Image
                  src="/foodies-logo.svg"
                  alt="Foodies"
                  fill
                  className="object-contain"
                  priority
                />
              </div>
              <div className="text-xs font-bold uppercase tracking-[0.22em] text-white/70">
                FOODIES
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}


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
      }, 520);
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
          initial={{ opacity: 0, y: 10, filter: "blur(6px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -10, filter: "blur(6px)" }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
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
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-[6px]"
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.985, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-col items-center gap-3"
            >
              <motion.div
                animate={{ scale: [1, 1.06, 1], rotate: [0, -2, 0] }}
                transition={{ duration: 0.52, ease: "easeInOut" }}
                className="relative h-12 w-12"
              >
                <Image src="/foodies-logo.png" alt="Foodies" fill className="object-contain" priority />
              </motion.div>
              <div className="text-[11px] font-black uppercase tracking-[0.28em] text-white/70">
                FOODIES
              </div>
              <div className="h-1 w-28 overflow-hidden rounded-full bg-white/10">
                <motion.div
                  initial={{ x: "-60%" }}
                  animate={{ x: "120%" }}
                  transition={{ duration: 0.52, ease: [0.22, 1, 0.36, 1] }}
                  className="h-full w-1/2 rounded-full bg-white/40"
                />
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}


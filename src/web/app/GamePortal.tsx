"use client";

import { useEffect, useRef } from "react";
import { parseBootFlags } from "../boot";
import type { BootHandle } from "../bootGame";

/**
 * The portal itself: the `<div>` the PixiJS renderer mounts into. Pixi, the
 * engine, and the IndexedDB save are all browser-only, so `bootGame` is
 * imported lazily *inside* the effect - nothing game-related is evaluated
 * during the static-export/prerender pass, keeping the exported HTML a bare
 * frame the client fills in on hydration.
 *
 * The effect is resilient to React StrictMode's mount/unmount/mount in dev: if
 * the component unmounts before `bootGame` resolves, the resolved handle is
 * disposed immediately instead of leaking a second running game.
 */
export function GamePortal() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = ref.current;
    if (!mount) return;

    let disposed = false;
    let handle: BootHandle | undefined;

    import("../bootGame")
      .then(({ bootGame }) =>
        bootGame(mount, parseBootFlags(window.location.search)),
      )
      .then((booted) => {
        if (disposed) {
          booted.dispose();
          return;
        }
        handle = booted;
      })
      .catch((error) => {
        console.error("ts-rogue failed to boot", error);
      });

    return () => {
      disposed = true;
      handle?.dispose();
    };
  }, []);

  return <div id="portal" className="portal" ref={ref} />;
}

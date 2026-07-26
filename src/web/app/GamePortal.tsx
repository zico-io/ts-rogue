"use client";

import { useEffect, useRef } from "react";
import { parseBootFlags } from "../boot";
import type { BootHandle } from "../bootGame";

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

"use client";

import { useEffect } from "react";
import { labelTableCells } from "../lib/label-table-cells";

/** Keeps `data-label` on table cells current as pages render and re-render. */
export function ResponsiveTables() {
  useEffect(() => {
    let frame = 0;
    const run = () => {
      frame = 0;
      labelTableCells(document);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(run);
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}

import { useEffect, useRef, useState } from "react";

/**
 * The rendered pixel width of an element.
 *
 * Charts here compute geometry in real pixels rather than drawing into a fixed
 * `viewBox`: with `preserveAspectRatio="meet"` a fixed viewBox scales to *fit*,
 * so a wide-but-short drawing gets limited by its height and renders centred
 * with empty gutters on both sides. Measuring instead keeps 1 SVG unit = 1 CSS
 * pixel, which also means stroke widths and font sizes stay exactly as
 * specified at any container width.
 */
export function useElementWidth(fallback = 680) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width);
      // Ignore the transient 0 a hidden or unmounting container reports.
      if (next > 0) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}

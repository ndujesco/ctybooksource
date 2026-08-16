"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Renders the invoice document at its true width (so exports are crisp and
 * layout never reflows) while visually scaling it down to fit the phone.
 */
export default function ScaledPreview({
  width = 680,
  children,
}: {
  width?: number;
  children: React.ReactNode;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const measure = () => {
      const s = Math.min(1, o.clientWidth / width);
      setScale(s);
      setHeight(i.scrollHeight * s);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(o);
    ro.observe(i);
    measure();
    return () => ro.disconnect();
  }, [width]);

  return (
    <div ref={outer} className="overflow-hidden" style={{ height: height || undefined }}>
      <div
        ref={inner}
        style={{ width, transform: `scale(${scale})`, transformOrigin: "top left" }}
      >
        {children}
      </div>
    </div>
  );
}

"use client";

import { useState, type CSSProperties } from "react";
import { fileUrl } from "./format";

/** A page's scan; if the file can't be loaded, a blank sheet instead of a broken-image icon. */
export function PageImage({
  id,
  alt = "",
  className,
  style,
  lazy,
}: {
  id: string;
  alt?: string;
  className?: string;
  style?: CSSProperties;
  lazy?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return <div className={["blank", className].filter(Boolean).join(" ")} style={style} role="img" aria-label={alt} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={fileUrl(id)}
      alt={alt}
      className={className}
      style={style}
      loading={lazy ? "lazy" : undefined}
      onError={() => setFailed(true)}
    />
  );
}

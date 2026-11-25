"use client";

import Link from "next/link";
import { forwardRef, useState, type ComponentProps } from "react";

/** Fully warm dynamic routes on pointer/keyboard intent, without fetching every transcript in a list. */
export const IntentLink = forwardRef<HTMLAnchorElement, ComponentProps<typeof Link>>(function IntentLink(
  { onMouseEnter, onFocus, onTouchStart, prefetch, ...props }, ref,
) {
  const [intent, setIntent] = useState(false);
  return <Link {...props} ref={ref} prefetch={prefetch ?? (intent ? true : null)}
    onMouseEnter={event => { setIntent(true); onMouseEnter?.(event); }}
    onFocus={event => { setIntent(true); onFocus?.(event); }}
    onTouchStart={event => { setIntent(true); onTouchStart?.(event); }} />;
});

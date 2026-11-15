"use client"

import * as React from "react"
import { cn } from "cn"
import * as ResizablePrimitive from "react-resizable-panels"
import { PANEL_COOKIE_MAX_AGE, panelCookieName } from "@/lib/panel-layout"

/**
 * Layout storage in cookies (see lib/panel-layout). During the server render it reads `fromServer`, the request's
 * cookies; in the browser it reads and writes document.cookie, so both renders start from the same layout.
 */
export function panelLayoutStorage(fromServer: Record<string, string> = {}): ResizablePrimitive.LayoutStorage {
  return {
    getItem(key) {
      const name = panelCookieName(key)
      if (typeof document === "undefined") return fromServer[name] ?? null
      const hit = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`))
      if (!hit) return null
      try {
        return decodeURIComponent(hit.slice(name.length + 1))
      } catch {
        return null
      }
    },
    setItem(key, value) {
      if (typeof document === "undefined") return
      document.cookie = `${panelCookieName(key)}=${encodeURIComponent(value)}; path=/; max-age=${PANEL_COOKIE_MAX_AGE}; samesite=lax`
    },
  }
}

const PanelCookies = React.createContext<Record<string, string>>({})

/** Hands the request's panel layout cookies to the panels below, for the server render. */
export function PanelLayoutCookies({ value, children }: { value: Record<string, string>; children: React.ReactNode }) {
  return <PanelCookies.Provider value={value}>{children}</PanelCookies.Provider>
}

/** Storage for `useDefaultLayout`, the same on the server and in the browser. */
export function usePanelLayoutStorage() {
  const fromServer = React.useContext(PanelCookies)
  return React.useMemo(() => panelLayoutStorage(fromServer), [fromServer])
}

function ResizablePanelGroup({
  className,
  ...props
}: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn(
        "flex h-full w-full aria-[orientation=vertical]:flex-col",
        className
      )}
      {...props}
    />
  )
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: ResizablePrimitive.SeparatorProps & {
  withHandle?: boolean
}) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        "relative flex w-px items-center justify-center bg-border ring-offset-background after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-1 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 [&[aria-orientation=horizontal]>div]:rotate-90",
        className
      )}
      {...props}
    >
      {withHandle && (
        <div className="z-10 flex h-6 w-1 shrink-0 rounded-lg bg-border" />
      )}
    </ResizablePrimitive.Separator>
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }

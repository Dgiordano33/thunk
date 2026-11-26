"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import { useStickToBottomContext } from "use-stick-to-bottom";
import { useSession } from "@/lib/store/session-store";
import { DocumentEditor } from "./document-editor";

/** Keep history searchable, but initialize editors only as they approach the conversation viewport. */
export function DeferredDocumentEditor(props: ComponentProps<typeof DocumentEditor>) {
  const { documentId } = props;
  const markdown = useSession((s) => s.documents[documentId]?.currentMarkdown ?? "");
  // The latest response is immediately editable. Older editors stay mounted once opened, preserving selection and undo.
  const [mounted, setMounted] = useState(() => useSession.getState().activeDocumentId === documentId);
  const ref = useRef<HTMLDivElement>(null);
  const { scrollRef } = useStickToBottomContext();

  useEffect(() => {
    if (mounted || !ref.current) return;
    let disposed = false;
    const show = () => { if (!disposed) setMounted(true); };
    if (typeof IntersectionObserver === "undefined") {
      const frame = requestAnimationFrame(show);
      return () => { disposed = true; cancelAnimationFrame(frame); };
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        show();
        observer.disconnect();
      }
    }, { root: scrollRef.current, rootMargin: "600px 0px" });
    observer.observe(ref.current);
    return () => { disposed = true; observer.disconnect(); };
  }, [mounted, scrollRef]);

  return (
    <div ref={ref} onFocusCapture={() => setMounted(true)} onPointerDown={() => setMounted(true)}>
      {mounted ? <DocumentEditor {...props} /> : <div className="doc-prose whitespace-pre-wrap">{markdown}</div>}
    </div>
  );
}

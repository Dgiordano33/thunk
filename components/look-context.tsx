"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useState } from "react";
import { storeLook, type Look } from "@/lib/look";

const LookContext = createContext<{ look: Look; setLook: (look: Look) => void }>({ look: "space", setLook: () => {} });

/** Holds the look the server rendered with; changing it saves the cookie and re-renders the server views (the maps). */
export function LookProvider({ initial, children }: { initial: Look; children: React.ReactNode }) {
  const router = useRouter();
  const [look, setState] = useState(initial);
  const setLook = useCallback(
    (next: Look) => {
      storeLook(next);
      setState(next);
      router.refresh();
    },
    [router],
  );
  return <LookContext value={{ look, setLook }}>{children}</LookContext>;
}

export const useLook = () => useContext(LookContext);

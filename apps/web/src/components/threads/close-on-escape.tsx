"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function CloseOnEscape({ href }: { href: string }) {
  const router = useRouter();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (event.defaultPrevented || event.isComposing) return;
      router.push(href);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router, href]);

  return null;
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { closeOnEscape } from "~/utils/close-on-escape";

export function CloseOnEscape({ href }: { href: string }) {
  const router = useRouter();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) =>
      closeOnEscape(event, () => router.push(href));
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router, href]);

  return null;
}

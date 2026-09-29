const MARGIN = 8;
const FALLBACK_WIDTH = 280;

export interface SuggestionPlacement {
  left: number;
  top: number | null;
  bottom: number | null;
}

export function suggestionPlacement(
  rect: { top: number; bottom: number; left: number },
  viewport: { width: number; height: number },
  width: number,
): SuggestionPlacement {
  const left = Math.max(
    MARGIN,
    Math.min(rect.left, viewport.width - width - MARGIN),
  );

  const spaceAbove = rect.top;
  const spaceBelow = viewport.height - rect.bottom;

  if (spaceAbove >= spaceBelow) {
    return { left, top: null, bottom: viewport.height - rect.top + MARGIN };
  }
  return { left, top: rect.bottom + MARGIN, bottom: null };
}

export function placeSuggestion(
  element: HTMLElement,
  rect: DOMRect | null,
): void {
  if (!rect) return;

  const placement = suggestionPlacement(
    rect,
    { width: window.innerWidth, height: window.innerHeight },
    element.offsetWidth || FALLBACK_WIDTH,
  );

  element.style.position = "fixed";
  element.style.zIndex = "50";
  element.style.left = `${placement.left}px`;
  element.style.top = placement.top === null ? "auto" : `${placement.top}px`;
  element.style.bottom =
    placement.bottom === null ? "auto" : `${placement.bottom}px`;
}

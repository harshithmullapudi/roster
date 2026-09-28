export const RAIL_PANEL_IDS = ["shell-main", "shell-rail"] as const;

export type RailLayout = Record<string, number>;

export function railLayoutKey(storageId: string): string {
  return ["react-resizable-panels", storageId, ...RAIL_PANEL_IDS].join(":");
}

export function parseRailLayout(raw: string | null): RailLayout | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const layout = parsed as Record<string, unknown>;
  const valid = RAIL_PANEL_IDS.every(
    (id) => typeof layout[id] === "number" && Number.isFinite(layout[id]),
  );
  return valid ? (layout as RailLayout) : null;
}

export function railLayoutReady(current: RailLayout): boolean {
  return RAIL_PANEL_IDS.every((id) => id in current);
}

export function shouldPersistRailLayout(
  layout: RailLayout,
  isUserInteraction: boolean,
): boolean {
  return isUserInteraction && RAIL_PANEL_IDS.every((id) => id in layout);
}

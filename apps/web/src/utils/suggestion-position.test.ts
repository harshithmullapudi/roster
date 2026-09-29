import { describe, expect, it } from "vitest";

import { suggestionPlacement } from "./suggestion-position";

const viewport = { width: 1280, height: 800 };

describe("suggestionPlacement", () => {
  it("anchors the bottom edge above a caret near the bottom", () => {
    const placement = suggestionPlacement(
      { top: 700, bottom: 720, left: 120 },
      viewport,
      280,
    );

    expect(placement.top).toBeNull();
    expect(placement.bottom).toBe(800 - 700 + 8);
    expect(placement.left).toBe(120);
  });

  it("drops below a caret near the top", () => {
    const placement = suggestionPlacement(
      { top: 40, bottom: 60, left: 120 },
      viewport,
      280,
    );

    expect(placement.bottom).toBeNull();
    expect(placement.top).toBe(60 + 8);
  });

  it("keeps the popup inside the right edge", () => {
    const placement = suggestionPlacement(
      { top: 700, bottom: 720, left: 1200 },
      viewport,
      280,
    );

    expect(placement.left).toBe(1280 - 280 - 8);
  });

  it("keeps the popup inside the left edge", () => {
    const placement = suggestionPlacement(
      { top: 700, bottom: 720, left: 2 },
      viewport,
      280,
    );

    expect(placement.left).toBe(8);
  });
});

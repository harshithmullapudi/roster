import { describe, expect, it } from "vitest";

import {
  parseRailLayout,
  railLayoutKey,
  shouldPersistRailLayout,
} from "./rail-layout";

describe("railLayoutKey", () => {
  it("matches the key format useDefaultLayout used, so saved layouts survive", () => {
    expect(railLayoutKey("roster.thread-rail")).toBe(
      "react-resizable-panels:roster.thread-rail:shell-main:shell-rail",
    );
  });
});

describe("parseRailLayout", () => {
  it("parses a stored two-panel layout", () => {
    expect(
      parseRailLayout('{"shell-main":62.5,"shell-rail":37.5}'),
    ).toEqual({ "shell-main": 62.5, "shell-rail": 37.5 });
  });

  it("rejects null, malformed json, and non-numeric sizes", () => {
    expect(parseRailLayout(null)).toBeNull();
    expect(parseRailLayout("not json")).toBeNull();
    expect(parseRailLayout('{"shell-main":"62"}')).toBeNull();
  });

  it("rejects a layout missing either panel", () => {
    expect(parseRailLayout('{"shell-main":100}')).toBeNull();
  });
});

describe("shouldPersistRailLayout", () => {
  it("persists a user-driven resize of the split view", () => {
    expect(
      shouldPersistRailLayout({ "shell-main": 60, "shell-rail": 40 }, true),
    ).toBe(true);
  });

  it("ignores library-driven layout events, which would clobber the saved split", () => {
    expect(
      shouldPersistRailLayout({ "shell-main": 50, "shell-rail": 50 }, false),
    ).toBe(false);
  });

  it("ignores layouts without the rail panel", () => {
    expect(shouldPersistRailLayout({ "shell-main": 100 }, true)).toBe(false);
  });
});

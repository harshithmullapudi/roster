import { describe, expect, it, vi } from "vitest";

import { closeOnEscape, type EscapeEvent } from "./close-on-escape";

function escapeEvent(overrides: Partial<EscapeEvent> = {}) {
  return {
    key: "Escape",
    defaultPrevented: false,
    isComposing: false,
    preventDefault: vi.fn(),
    ...overrides,
  };
}

describe("closeOnEscape", () => {
  it("closes the thread on a bare Escape", () => {
    const close = vi.fn();
    closeOnEscape(escapeEvent(), close);
    expect(close).toHaveBeenCalledOnce();
  });

  it("consumes the Escape it acted on, so macOS keeps the window full screen", () => {
    const event = escapeEvent();
    closeOnEscape(event, vi.fn());
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it("ignores keys that are not Escape", () => {
    const event = escapeEvent({ key: "a" });
    const close = vi.fn();
    closeOnEscape(event, close);
    expect(close).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("leaves an overlay's own Escape alone", () => {
    const event = escapeEvent({ defaultPrevented: true });
    const close = vi.fn();
    closeOnEscape(event, close);
    expect(close).not.toHaveBeenCalled();
  });

  it("stays out of an IME composition", () => {
    const event = escapeEvent({ isComposing: true });
    const close = vi.fn();
    closeOnEscape(event, close);
    expect(close).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});

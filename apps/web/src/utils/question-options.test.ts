import { describe, expect, it } from "vitest";

import { questionOptions } from "./question-options";

describe("questionOptions", () => {
  it("extracts a numbered list of answers", () => {
    const text = [
      "Before I touch the prod mirror: should I rotate that one too?",
      "",
      "1. Rotate both (staging + prod mirror)",
      "2. Staging only, file a task for prod",
    ].join("\n");

    expect(questionOptions(text)).toEqual([
      "Rotate both (staging + prod mirror)",
      "Staging only, file a task for prod",
    ]);
  });

  it("supports the 1) numbering style", () => {
    const text = "Which one?\n1) Ship it\n2) Hold for review";
    expect(questionOptions(text)).toEqual(["Ship it", "Hold for review"]);
  });

  it("returns nothing for plain prose", () => {
    expect(questionOptions("Should I rotate the prod key too?")).toEqual([]);
  });

  it("needs at least two options to call it a choice", () => {
    expect(questionOptions("Plan:\n1. Do the thing")).toEqual([]);
  });

  it("ignores numbering that does not start at one", () => {
    expect(questionOptions("As discussed:\n2. second\n3. third")).toEqual([]);
  });

  it("ignores numbering that skips", () => {
    expect(questionOptions("Pick:\n1. first\n3. third")).toEqual([]);
  });

  it("treats long numbered paragraphs as prose, not options", () => {
    const long = "x".repeat(200);
    expect(questionOptions(`Pick:\n1. ${long}\n2. short`)).toEqual([]);
  });

  it("caps at six options", () => {
    const text = [
      "Pick:",
      ...Array.from({ length: 8 }, (_, i) => `${i + 1}. option ${i + 1}`),
    ].join("\n");
    expect(questionOptions(text)).toHaveLength(6);
  });
});

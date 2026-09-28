import { describe, expect, it } from "vitest";

import { combinedAnswer, questionGroups } from "./question-options";

describe("questionGroups", () => {
  it("extracts a numbered list of answers", () => {
    const text = [
      "Before I touch the prod mirror: should I rotate that one too?",
      "",
      "1. Rotate both (staging + prod mirror)",
      "2. Staging only, file a task for prod",
    ].join("\n");

    expect(questionGroups(text)).toEqual([
      {
        question:
          "Before I touch the prod mirror: should I rotate that one too?",
        options: [
          "Rotate both (staging + prod mirror)",
          "Staging only, file a task for prod",
        ],
      },
    ]);
  });

  it("supports the 1) numbering style", () => {
    const groups = questionGroups("Which one?\n1) Ship it\n2) Hold for review");
    expect(groups[0]?.options).toEqual(["Ship it", "Hold for review"]);
  });

  it("returns nothing for plain prose", () => {
    expect(questionGroups("Should I rotate the prod key too?")).toEqual([]);
  });

  it("needs at least two options to call it a choice", () => {
    expect(questionGroups("Plan:\n1. Do the thing")).toEqual([]);
  });

  it("ignores numbering that does not start at one", () => {
    expect(questionGroups("As discussed:\n2. second\n3. third")).toEqual([]);
  });

  it("drops a group whose numbering skips", () => {
    expect(questionGroups("Pick:\n1. first\n3. third")).toEqual([]);
  });

  it("treats long numbered paragraphs as prose, not options", () => {
    const long = "x".repeat(200);
    expect(questionGroups(`Pick:\n1. ${long}\n2. short`)).toEqual([]);
  });

  it("caps a group at six options", () => {
    const text = [
      "Pick:",
      ...Array.from({ length: 8 }, (_, i) => `${i + 1}. option ${i + 1}`),
    ].join("\n");
    expect(questionGroups(text)[0]?.options).toHaveLength(6);
  });

  it("keeps every question in a message that asks several", () => {
    const text = [
      "Two things before I continue.",
      "",
      "**Rotate the prod mirror too?**",
      "1. Rotate both",
      "2. Staging only",
      "",
      "**When should the deploy go out?**",
      "1. Now",
      "2. After hours",
    ].join("\n");

    expect(questionGroups(text)).toEqual([
      {
        question: "Rotate the prod mirror too?",
        options: ["Rotate both", "Staging only"],
      },
      {
        question: "When should the deploy go out?",
        options: ["Now", "After hours"],
      },
    ]);
  });

  it("strips markdown headings from the question line", () => {
    const groups = questionGroups("## Which port?\n1. 3000\n2. 3210");
    expect(groups[0]?.question).toBe("Which port?");
  });

  it("has a null question when no prose precedes the list", () => {
    const groups = questionGroups("1. yes\n2. no");
    expect(groups[0]?.question).toBeNull();
  });

  it("keeps a valid group when a sibling group is broken", () => {
    const text = [
      "First:",
      "1. only one option",
      "",
      "Second:",
      "1. red",
      "2. blue",
    ].join("\n");

    expect(questionGroups(text)).toEqual([
      { question: "Second:", options: ["red", "blue"] },
    ]);
  });
});

describe("combinedAnswer", () => {
  it("is just the choice for a single unlabeled group", () => {
    expect(
      combinedAnswer([{ question: null, options: ["a", "b"] }], ["a"]),
    ).toBe("a");
  });

  it("quotes each question above its answer", () => {
    const groups = [
      { question: "Rotate the prod mirror too?", options: ["yes", "no"] },
      { question: "Deploy window?", options: ["now", "later"] },
    ];

    expect(combinedAnswer(groups, ["no", "later"])).toBe(
      ["> Rotate the prod mirror too?", "no", "", "> Deploy window?", "later"].join(
        "\n",
      ),
    );
  });
});

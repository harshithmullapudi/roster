import { describe, expect, it } from "vitest";

import { toSegments, toTsQuery } from "./search-query";

const OPEN = "\u0002";
const CLOSE = "\u0003";

function mark(text: string): string {
  return `${OPEN}${text}${CLOSE}`;
}

describe("toTsQuery", () => {
  it("treats the term being typed as a prefix", () => {
    expect(toTsQuery("deplo")).toBe("deplo:*");
  });

  it("requires every term and only prefixes the last", () => {
    expect(toTsQuery("staging deplo")).toBe("staging & deplo:*");
  });

  it("strips punctuation that would otherwise be tsquery syntax", () => {
    expect(toTsQuery("deploy(:&|)")).toBe("deploy:*");
  });

  it("turns a leading dash into a negation", () => {
    expect(toTsQuery("deploy -staging")).toBe("deploy & !staging");
  });

  it("refuses a query with nothing positive to match", () => {
    expect(toTsQuery("-staging")).toBeNull();
  });

  it("returns null for blank input", () => {
    expect(toTsQuery("")).toBeNull();
    expect(toTsQuery("   ")).toBeNull();
    expect(toTsQuery("!!!")).toBeNull();
  });

  it("caps how many terms reach the database", () => {
    const query = toTsQuery(
      "one two three four five six seven eight nine ten eleven twelve",
    );
    expect(query?.split(" & ")).toHaveLength(10);
    expect(query).not.toContain("eleven");
  });
});

describe("toSegments", () => {
  it("pulls the marked words out of a headline", () => {
    expect(toSegments(`we shipped the ${mark("deployment")} on Tuesday`)).toEqual([
      { text: "we shipped the ", hit: false },
      { text: "deployment", hit: true },
      { text: " on Tuesday", hit: false },
    ]);
  });

  it("handles a headline that is nothing but the hit", () => {
    expect(toSegments(mark("deployment"))).toEqual([
      { text: "deployment", hit: true },
    ]);
  });

  it("handles several hits", () => {
    expect(toSegments(`${mark("staging")} and ${mark("production")}`)).toEqual([
      { text: "staging", hit: true },
      { text: " and ", hit: false },
      { text: "production", hit: true },
    ]);
  });

  it("leaves an unmarked headline alone", () => {
    expect(toSegments("plain text")).toEqual([
      { text: "plain text", hit: false },
    ]);
  });

  it("survives a sentinel that never closes", () => {
    expect(toSegments(`before ${OPEN}after`)).toEqual([
      { text: "before ", hit: false },
      { text: "after", hit: true },
    ]);
  });

  it("returns nothing for an empty headline", () => {
    expect(toSegments("")).toEqual([]);
  });
});

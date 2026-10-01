import { describe, expect, it } from "vitest";

import {
  type ReferenceSource,
  collectReferences,
} from "./thread-references";

const link = (href: string, label = href) => ({
  type: "text",
  text: label,
  marks: [{ type: "link", attrs: { href } }],
});

const doc = (...content: unknown[]) => ({
  type: "doc",
  content: [{ type: "paragraph", content }],
});

const message = (
  seq: number,
  parts: Partial<ReferenceSource> = {},
): ReferenceSource => ({
  id: `message-${seq}`,
  seq,
  body: null,
  text: "",
  attachments: [],
  ...parts,
});

const file = (id: string, filename: string, mimeType = "image/png") => ({
  id,
  filename,
  mimeType,
  size: 1024,
  width: null,
  height: null,
  url: `/api/files/${id}`,
});

describe("collectReferences", () => {
  it("collects attachments newest first", () => {
    const found = collectReferences([
      message(1, { attachments: [file("a", "old.png")] }),
      message(2, { attachments: [file("b", "new.pdf", "application/pdf")] }),
    ]);

    expect(found.files.map((entry) => entry.filename)).toEqual([
      "new.pdf",
      "old.png",
    ]);
    expect(found.files[0]?.url).toBe("/api/files/b");
  });

  it("finds a link written through the composer's link mark", () => {
    const found = collectReferences([
      message(1, { body: doc(link("https://google.com", "google")) }),
    ]);

    expect(found.links).toEqual([
      { href: "https://google.com", label: "google.com", seq: 1 },
    ]);
  });

  it("finds a bare url pasted as plain text", () => {
    const found = collectReferences([
      message(1, { text: "see https://example.com/docs/intro for the rest" }),
    ]);

    expect(found.links[0]).toMatchObject({
      href: "https://example.com/docs/intro",
      label: "example.com/docs/intro",
    });
  });

  it("drops punctuation that trails a bare url", () => {
    const found = collectReferences([
      message(1, { text: "landed (https://example.com/a), finally." }),
    ]);

    expect(found.links[0]?.href).toBe("https://example.com/a");
  });

  it("keeps one entry when the same url is shared twice", () => {
    const found = collectReferences([
      message(1, { text: "https://example.com/a" }),
      message(2, { body: doc(link("https://example.com/a")) }),
    ]);

    expect(found.links).toHaveLength(1);
    expect(found.links[0]?.seq).toBe(2);
  });

  it("reads a superset page link as a page", () => {
    const found = collectReferences([
      message(1, {
        text: "https://app.superset.sh/page/superset-mobile-on-ipad-screen-audit-gryaka",
      }),
    ]);

    expect(found.pages).toEqual([
      {
        href: "https://app.superset.sh/page/superset-mobile-on-ipad-screen-audit-gryaka",
        slug: "superset-mobile-on-ipad-screen-audit-gryaka",
        label: "Superset mobile on ipad screen audit",
        seq: 1,
      },
    ]);
    expect(found.links).toHaveLength(0);
  });

  it("keeps a short page slug whole", () => {
    const found = collectReferences([
      message(1, { text: "https://app.superset.sh/page/roadmap" }),
    ]);

    expect(found.pages[0]?.label).toBe("Roadmap");
  });

  it("reads a github pull request as a pull request", () => {
    const found = collectReferences([
      message(1, { text: "https://github.com/superset-sh/roster/pull/64" }),
    ]);

    expect(found.pullRequests).toEqual([
      {
        href: "https://github.com/superset-sh/roster/pull/64",
        owner: "superset-sh",
        repo: "roster",
        number: 64,
        label: "roster #64",
        seq: 1,
      },
    ]);
    expect(found.links).toHaveLength(0);
  });

  it("keeps a pull request link when it points at a file in the diff", () => {
    const found = collectReferences([
      message(1, {
        text: "https://github.com/superset-sh/roster/pull/64/files#diff-abc",
      }),
    ]);

    expect(found.pullRequests[0]?.number).toBe(64);
  });

  it("leaves an ordinary github link under links", () => {
    const found = collectReferences([
      message(1, { text: "https://github.com/superset-sh/roster/issues/12" }),
    ]);

    expect(found.pullRequests).toHaveLength(0);
    expect(found.links[0]?.label).toBe("github.com/superset-sh/roster/issues/12");
  });

  it("ignores a url with a scheme the browser should not open", () => {
    const found = collectReferences([
      message(1, { body: doc(link("javascript:alert(1)", "click me")) }),
    ]);

    expect(found.links).toHaveLength(0);
  });

  it("strips www and a trailing slash from a link label", () => {
    const found = collectReferences([
      message(1, { text: "https://www.example.com/" }),
    ]);

    expect(found.links[0]?.label).toBe("example.com");
  });

  it("finds a link nested in a list item", () => {
    const found = collectReferences([
      message(1, {
        body: {
          type: "doc",
          content: [
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [doc(link("https://example.com/deep"))],
                },
              ],
            },
          ],
        },
      }),
    ]);

    expect(found.links[0]?.href).toBe("https://example.com/deep");
  });

  it("returns empty lists for a thread that shared nothing", () => {
    const found = collectReferences([message(1, { text: "just talking" })]);

    expect(found).toEqual({
      files: [],
      pullRequests: [],
      pages: [],
      links: [],
    });
  });
});

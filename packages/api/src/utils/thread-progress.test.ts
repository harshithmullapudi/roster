import { describe, expect, it } from "vitest";

import { agentReply } from "./thread-progress";

const HARNESS = `User: what broke?
Assistant: I looked at the wrong log.
User: and now?
Assistant: The disk filled up.`;

const TUI = `  roster read messages --channel-id 522cf3d5 --limit 20
  Answer in your final message — it is sent back to them verbatim.
  </roster>

  Reply with exactly the word: pong. Do not do anything else.

⏺ pong

✻ Brewed for 2s

  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents
                    ✘ Auto-update failed · Try claude doctor or npm i -g @anthropic-ai/claude-code
                                                                    ● high · /effort`;

const NO_TURN = `  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents
  ✘ Auto-update failed · Try claude doctor
  · Sublimating…`;

const MARKDOWN = `⏺ Here is the rule:

\`\`\`css
pre { @apply w-fit rounded-md p-4; }
\`\`\`

## The change

\`\`\`ts
function f() {
  return 1;
}
\`\`\`

| col | val |
| --- | --- |
| a   | 1   |

---

Done.

✻ Brewed for 2s`;

describe("reading an agent's reply out of a transcript", () => {
  it("takes the last turn of a harness transcript", () => {
    expect(agentReply(HARNESS)).toBe("The disk filled up.");
  });

  it("keeps the lines a markdown message is built from", () => {
    const reply = agentReply(MARKDOWN) ?? "";

    expect(reply.match(/^```$/gm)).toHaveLength(2);
    expect(reply).toContain("\n}\n");
    expect(reply).toContain("| --- | --- |");
    expect(reply).toContain("\n---\n");
    expect(reply).not.toContain("Brewed for 2s");
  });

  it("leaves a fenced block closed so the rest is not swallowed as code", () => {
    const reply = agentReply(MARKDOWN) ?? "";
    const fences = reply.split("\n").filter((line) => line.startsWith("```"));

    expect(fences).toHaveLength(4);
    expect(reply.indexOf("## The change")).toBeGreaterThan(
      reply.indexOf("```css"),
    );
    expect(reply.split("```css")[1]?.split("```")[0]).not.toContain(
      "## The change",
    );
  });

  it("takes the last turn of a terminal transcript, without the chrome", () => {
    expect(agentReply(TUI)).toBe("pong");
  });

  it("does not end the reply at a bold run or a star bullet", () => {
    const reply = agentReply(`⏺ Here is what I found:

**The root cause** is the chrome filter.

* first bullet
* second bullet

Done.

✻ Brewed for 2s`);

    expect(reply).toContain("**The root cause**");
    expect(reply).toContain("* second bullet");
    expect(reply).toContain("Done.");
    expect(reply).not.toContain("Brewed for 2s");
  });

  it("says nothing rather than handing back the whole screen", () => {
    expect(agentReply(NO_TURN)).toBeNull();
  });
});

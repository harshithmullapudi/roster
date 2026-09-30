import { handleList } from "./handle-list";

/**
 * A channel's own agent runs every thread in it. Agents tagged alongside it
 * never see the message, so the note tells it who to pass the work on to.
 */
export function relayNote(args: {
  handles: string[];
  threadId: string;
  me: string;
}): string | null {
  if (args.handles.length === 0) return null;

  const each = args.handles.length === 1 ? "them" : "each of them";

  return [
    `Tagged in that message: ${handleList(args.handles)}. They cannot see it —`,
    `ask ${each} yourself before this turn ends:`,
    ...args.handles.map(
      (handle) =>
        `  roster ask ${handle} <what you need from them> --thread ${args.threadId} --as ${args.me}`,
    ),
    "Then say what you asked for and end your turn. You are resumed once every",
    "answer is back.",
  ].join("\n");
}

export function withRelayNote(args: {
  text: string;
  handles: string[];
  threadId: string;
  me: string;
}): string {
  const note = relayNote({
    handles: args.handles,
    threadId: args.threadId,
    me: args.me,
  });
  return note ? `${args.text}\n\n${note}` : args.text;
}

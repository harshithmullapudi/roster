import { members, messages, users } from "@roster/db";
import { sql } from "drizzle-orm";

import { agentDisplay, normalizeHandle } from "../lib/agent-identity";
import { attachmentsForMessages, type MessageAttachment } from "./attachments";
import { type ReactionRef, toReactionRefs } from "./reactions";

export interface ChannelMessage {
  id: string;
  projectId: string;
  seq: number;
  kind: string;
  body: unknown;
  text: string;
  clientId: string | null;
  parentMessageId: string | null;
  threadId: string | null;
  createdAt: Date;
  editedAt: Date | null;
  authorMemberId: string | null;
  authorName: string | null;
  authorEmail: string | null;
  agentChannelId: string | null;
  agentDisplay: string | null;
  agentHandle: string | null;
  attachments: MessageAttachment[];
  reactions: ReactionRef[];
}

const reactionsSql = sql<ReactionRef[]>`coalesce((select jsonb_agg(jsonb_build_object('emoji', r.emoji, 'memberId', r.member_id))
  from roster.reactions r where r.message_id = ${messages.id}), '[]'::jsonb)`;

export const messageColumns = {
  id: messages.id,
  projectId: messages.projectId,
  seq: messages.seq,
  kind: messages.kind,
  body: messages.body,
  text: messages.text,
  clientId: messages.clientId,
  parentMessageId: messages.parentMessageId,
  threadId: messages.threadId,
  createdAt: messages.createdAt,
  editedAt: messages.editedAt,
  authorMemberId: messages.authorMemberId,
  authorName: users.name,
  authorEmail: users.email,
  authorType: members.type,
  authorAgentName: members.agentName,
  agentChannelId: messages.agentChannelId,
  reactions: reactionsSql.as("message_reactions"),
};

export interface MessageRow {
  id: string;
  projectId: string;
  seq: number;
  kind: string;
  body: unknown;
  text: string;
  clientId: string | null;
  parentMessageId: string | null;
  threadId: string | null;
  createdAt: Date;
  editedAt: Date | null;
  authorMemberId: string | null;
  authorName: string | null;
  authorEmail: string | null;
  authorType: string | null;
  authorAgentName: string | null;
  agentChannelId: string | null;
  reactions: unknown;
}

export function toChannelMessage(row: MessageRow): ChannelMessage {
  const { authorType, authorAgentName, reactions, ...rest } =
    row;
  const spokenByAgent = authorType === "agent";
  const handle = spokenByAgent ? normalizeHandle(authorAgentName) : null;

  return {
    ...rest,
    seq: Number(row.seq),
    reactions: toReactionRefs(reactions),
    authorName: spokenByAgent ? null : row.authorName,
    authorEmail: spokenByAgent ? null : row.authorEmail,
    agentChannelId: row.agentChannelId ?? (spokenByAgent ? row.projectId : null),
    agentHandle: handle,
    agentDisplay: handle ? agentDisplay(handle) : null,
    attachments: [],
  };
}

export async function withAttachments(
  list: ChannelMessage[],
): Promise<ChannelMessage[]> {
  if (list.length === 0) return list;

  const grouped = await attachmentsForMessages(list.map((message) => message.id));
  if (grouped.size === 0) return list;

  return list.map((message) => {
    const files = grouped.get(message.id);
    return files ? { ...message, attachments: files } : message;
  });
}

export async function withAttachment(
  message: ChannelMessage,
): Promise<ChannelMessage> {
  const [hydrated] = await withAttachments([message]);
  return hydrated ?? message;
}

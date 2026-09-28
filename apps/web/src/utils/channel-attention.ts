export function channelAttentionKey() {
  return ["channels", "attention"] as const;
}

export function dropChannelAttention(
  previous: string[] | undefined,
  projectId: string,
): string[] | undefined {
  return previous?.filter((id) => id !== projectId);
}

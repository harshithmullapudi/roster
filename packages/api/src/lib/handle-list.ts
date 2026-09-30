export function handleList(handles: string[]): string {
  const tagged = handles.map((handle) => `@${handle}`);
  if (tagged.length <= 1) return tagged.join("");

  return `${tagged.slice(0, -1).join(", ")} and ${tagged[tagged.length - 1]}`;
}

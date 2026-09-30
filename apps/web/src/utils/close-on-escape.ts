export interface EscapeEvent {
  key: string;
  defaultPrevented: boolean;
  isComposing: boolean;
  preventDefault: () => void;
}

export function closeOnEscape(event: EscapeEvent, close: () => void): void {
  if (event.key !== "Escape") return;
  if (event.defaultPrevented || event.isComposing) return;
  event.preventDefault();
  close();
}

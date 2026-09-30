import { stripEnvelope } from "./roster-envelope";

const MAX_PROGRESS_LENGTH = 160;

const CSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]/g;
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const OTHER_ESCAPE = /\x1b[()#][0-9A-Za-z]|\x1b[=>]/g;
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const CARRIAGE = /\r/g;
const ROLE_PREFIX = /^(?:Assistant|User):[ \t]*/;
const CHROME_ONLY = /^[\s\u2500-\u259f\u25a0-\u25ff\u2022\u00b7*>|_=+-]+$/;

export function stripAnsi(value: string): string {
  return value
    .replace(OSC, "")
    .replace(CSI, "")
    .replace(OTHER_ESCAPE, "")
    .replace(CARRIAGE, "\n")
    .replace(CONTROL, "");
}

function isChrome(line: string): boolean {
  if (line.length === 0) return false;
  if (CHROME_ONLY.test(line)) return true;
  return !/[A-Za-z0-9]/.test(line);
}

export function lastMeaningfulLine(transcript: string): string | null {
  const lines = stripEnvelope(stripAnsi(transcript)).split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = (lines[index] ?? "").trim().replace(ROLE_PREFIX, "");
    if (line.length === 0 || isChrome(line)) continue;
    return line.length > MAX_PROGRESS_LENGTH
      ? `${line.slice(0, MAX_PROGRESS_LENGTH - 1).trimEnd()}…`
      : line;
  }
  return null;
}

const ASSISTANT_TURN = /^Assistant:[ \t]*/gm;
const TERMINAL_TURN = /^[ \t]*⏺[ \t]*/gm;
const TERMINAL_STATUS = /^[·•●✢✳✴✶✻✽✘⏵]/;

function afterLastTurn(text: string, marker: RegExp): string | null {
  let index = -1;
  let length = 0;
  marker.lastIndex = 0;

  for (
    let match = marker.exec(text);
    match !== null;
    match = marker.exec(text)
  ) {
    index = match.index;
    length = match[0].length;
  }

  return index === -1 ? null : text.slice(index + length);
}

function upToStatusLine(text: string): string {
  const kept: string[] = [];
  for (const line of text.split("\n")) {
    if (TERMINAL_STATUS.test(line.trim())) break;
    kept.push(line);
  }
  return kept.join("\n");
}

export function agentReply(transcript: string): string | null {
  const text = stripEnvelope(stripAnsi(transcript));

  const spoken = afterLastTurn(text, ASSISTANT_TURN);
  if (spoken !== null) return spoken.trim() || null;

  const typed = afterLastTurn(text, TERMINAL_TURN);
  if (typed === null) return null;

  return upToStatusLine(typed).trim() || null;
}

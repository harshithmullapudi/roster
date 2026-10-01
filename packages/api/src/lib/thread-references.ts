import type { MessageAttachment } from "./attachments";

export interface ReferenceSource {
  id: string;
  seq: number;
  body: unknown;
  text: string;
  attachments: MessageAttachment[];
}

export interface ThreadFile {
  id: string;
  filename: string;
  mimeType: string;
  url: string;
  seq: number;
}

export interface ThreadLink {
  href: string;
  label: string;
  seq: number;
}

export interface ThreadPage extends ThreadLink {
  slug: string;
}

export interface ThreadPullRequest extends ThreadLink {
  owner: string;
  repo: string;
  number: number;
}

export interface ThreadReferences {
  files: ThreadFile[];
  pullRequests: ThreadPullRequest[];
  pages: ThreadPage[];
  links: ThreadLink[];
}

const BARE_URL = /https?:\/\/[^\s<>"']+/g;
const TRAILING = /[.,;:!?)\]}'"]+$/;
const PAGE_PATH = /^\/page\/([^/]+)/;
const PULL_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)/;
const PAGE_SUFFIX = /^[a-z0-9]{6}$/;

const PAGE_HOST = "app.superset.sh";
const GITHUB_HOST = "github.com";

export function collectReferences(
  sources: ReferenceSource[],
): ThreadReferences {
  const ordered = [...sources].sort((left, right) => left.seq - right.seq);

  return {
    files: collectFiles(ordered),
    ...collectUrls(ordered),
  };
}

function collectFiles(sources: ReferenceSource[]): ThreadFile[] {
  const files: ThreadFile[] = [];

  for (let index = sources.length - 1; index >= 0; index -= 1) {
    const source = sources[index];
    if (!source) continue;
    for (const attachment of source.attachments) {
      files.push({
        id: attachment.id,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        url: attachment.url,
        seq: source.seq,
      });
    }
  }

  return files;
}

function collectUrls(
  sources: ReferenceSource[],
): Omit<ThreadReferences, "files"> {
  const seen = new Map<string, number>();

  for (const source of sources) {
    for (const href of [...bodyLinks(source.body), ...textLinks(source.text)]) {
      seen.set(href, source.seq);
    }
  }

  const pullRequests: ThreadPullRequest[] = [];
  const pages: ThreadPage[] = [];
  const links: ThreadLink[] = [];

  for (const [href, seq] of seen) {
    const url = parse(href);
    if (!url) continue;

    const pull = asPullRequest(url, href, seq);
    if (pull) {
      pullRequests.push(pull);
      continue;
    }

    const page = asPage(url, href, seq);
    if (page) {
      pages.push(page);
      continue;
    }

    links.push({ href, label: linkLabel(url), seq });
  }

  const newestFirst = <T extends ThreadLink>(entries: T[]) =>
    entries.sort((left, right) => right.seq - left.seq);

  return {
    pullRequests: newestFirst(pullRequests),
    pages: newestFirst(pages),
    links: newestFirst(links),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function bodyLinks(body: unknown): string[] {
  const found: string[] = [];

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (!isRecord(node)) return;

    if (Array.isArray(node.marks)) {
      for (const mark of node.marks) {
        if (!isRecord(mark) || mark.type !== "link") continue;
        const attrs = isRecord(mark.attrs) ? mark.attrs : {};
        if (typeof attrs.href === "string") found.push(attrs.href.trim());
      }
    }

    walk(node.content);
  };

  walk(body);
  return found;
}

function textLinks(text: string): string[] {
  return (text.match(BARE_URL) ?? []).map((match) =>
    match.replace(TRAILING, ""),
  );
}

function parse(href: string): URL | null {
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function host(url: URL): string {
  return url.hostname.replace(/^www\./, "");
}

function asPullRequest(
  url: URL,
  href: string,
  seq: number,
): ThreadPullRequest | null {
  if (host(url) !== GITHUB_HOST) return null;

  const match = PULL_PATH.exec(url.pathname);
  if (!match) return null;

  const [, owner, repo, number] = match;
  if (!owner || !repo || !number) return null;

  return {
    href,
    owner,
    repo,
    number: Number(number),
    label: `${repo} #${number}`,
    seq,
  };
}

function asPage(url: URL, href: string, seq: number): ThreadPage | null {
  if (host(url) !== PAGE_HOST) return null;

  const match = PAGE_PATH.exec(url.pathname);
  const slug = match?.[1];
  if (!slug) return null;

  return { href, slug, label: pageLabel(slug), seq };
}

function pageLabel(slug: string): string {
  const words = readable(slug).split("-").filter(Boolean);
  const last = words[words.length - 1];
  if (words.length > 2 && last && PAGE_SUFFIX.test(last)) words.pop();

  const title = words.join(" ");
  return title.charAt(0).toUpperCase() + title.slice(1);
}

function readable(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function linkLabel(url: URL): string {
  const path = `${url.pathname}${url.search}`.replace(/\/$/, "");
  return `${host(url)}${path}`;
}

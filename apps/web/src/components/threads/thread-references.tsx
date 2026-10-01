"use client";

import type {
  ThreadFile,
  ThreadLink,
  ThreadPage,
  ThreadPullRequest,
  ThreadReferences as References,
} from "@roster/api";
import {
  Button,
  cn,
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@roster/ui";
import { useQuery } from "@tanstack/react-query";
import {
  AppWindow,
  FileText,
  GitPullRequest,
  Image as ImageIcon,
  LayoutList,
  Link2,
  Loader2,
  SquareArrowOutUpRight,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { attachmentKind } from "~/utils/attachments";
import { trpc } from "~/utils/trpc";

export interface ThreadReferencesProps {
  projectId: string;
  threadId: string;
  className?: string;
}

export function ThreadReferences({
  projectId,
  threadId,
  className,
}: ThreadReferencesProps) {
  const [open, setOpen] = useState(false);

  const { data, isError } = useQuery({
    queryKey: ["thread-references", threadId],
    queryFn: () => trpc.threads.references.query({ projectId, threadId }),
    enabled: open,
    staleTime: 30_000,
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          aria-label="Shared in this thread"
          className={cn("text-muted-foreground !rounded-md", className)}
        >
          <LayoutList size={14} />
        </Button>
      </PopoverTrigger>

      <PopoverPortal>
        <PopoverContent
          align="end"
          className="flex max-h-[380px] w-80 flex-col overflow-y-auto p-1.5"
        >
          {isError ? (
            <p className="text-muted-foreground px-2 py-5 text-center text-sm">
              Could not read this thread.
            </p>
          ) : data ? (
            <ReferenceList references={data} />
          ) : (
            <span className="flex items-center justify-center py-6">
              <Loader2 className="text-muted-foreground size-4 animate-spin" />
            </span>
          )}
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}

function ReferenceList({ references }: { references: References }) {
  const { files, pullRequests, pages, links } = references;
  const total =
    files.length + pullRequests.length + pages.length + links.length;

  if (total === 0) {
    return (
      <p className="text-muted-foreground px-2 py-5 text-center text-sm">
        Nothing shared in this thread yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Section heading="Files" count={files.length}>
        {files.map((file) => (
          <FileRow key={file.id} file={file} />
        ))}
      </Section>

      <Section heading="Pull requests" count={pullRequests.length}>
        {pullRequests.map((pull) => (
          <PullRequestRow key={pull.href} pull={pull} />
        ))}
      </Section>

      <Section heading="Pages" count={pages.length}>
        {pages.map((page) => (
          <PageRow key={page.href} page={page} />
        ))}
      </Section>

      <Section heading="Links" count={links.length}>
        {links.map((link) => (
          <LinkRow key={link.href} link={link} />
        ))}
      </Section>
    </div>
  );
}

function Section({
  heading,
  count,
  children,
}: {
  heading: string;
  count: number;
  children: ReactNode;
}) {
  if (count === 0) return null;

  return (
    <section className="flex flex-col">
      <span className="text-muted-foreground flex items-center justify-between px-2 pb-1 text-xs">
        {heading}
        <span className="tabular-nums">{count}</span>
      </span>
      {children}
    </section>
  );
}

function Row({
  href,
  icon,
  label,
  detail,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  detail?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={detail ? `${label} · ${detail}` : label}
      className="hover:bg-accent group flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5"
    >
      <span className="text-muted-foreground flex size-4 shrink-0 items-center justify-center">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
      {detail ? (
        <span className="text-muted-foreground max-w-[40%] shrink-0 truncate text-xs">
          {detail}
        </span>
      ) : null}
      <SquareArrowOutUpRight
        size={12}
        className="text-muted-foreground shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
      />
    </a>
  );
}

function FileRow({ file }: { file: ThreadFile }) {
  const image = attachmentKind(file.mimeType) === "image";

  return (
    <Row
      href={file.url}
      icon={image ? <ImageIcon size={14} /> : <FileText size={14} />}
      label={file.filename}
    />
  );
}

function PullRequestRow({ pull }: { pull: ThreadPullRequest }) {
  return (
    <Row
      href={pull.href}
      icon={<GitPullRequest size={14} />}
      label={pull.label}
      detail={pull.owner}
    />
  );
}

function PageRow({ page }: { page: ThreadPage }) {
  return (
    <Row href={page.href} icon={<AppWindow size={14} />} label={page.label} />
  );
}

function LinkRow({ link }: { link: ThreadLink }) {
  return <Row href={link.href} icon={<Link2 size={14} />} label={link.label} />;
}

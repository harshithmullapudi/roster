"use client";

import type { Channel, ChannelGroups } from "@roster/api";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { readCollapsed, writeCollapsed } from "~/utils/sidebar-collapse";
import { trpc } from "~/utils/trpc";

import { ChannelSection } from "./channel-section";
import { CreateChannelDialog } from "./create-channel-dialog";

export interface ChannelSectionsProps {
  groups: ChannelGroups;
  orgSlug: string;
  activeChannelSlug?: string;
  canManage: boolean;
  canCreate: boolean;
}

const SECTIONS: { key: keyof ChannelGroups; label: string }[] = [
  { key: "starred", label: "Starred" },
  { key: "public", label: "Public" },
  { key: "private", label: "Private" },
];

function regroup(groups: ChannelGroups, changed: Channel): ChannelGroups {
  const all = [...groups.starred, ...groups.public, ...groups.private].map(
    (channel) => (channel.id === changed.id ? changed : channel),
  );

  const next: ChannelGroups = { starred: [], public: [], private: [] };
  for (const channel of all) {
    if (channel.starred) next.starred.push(channel);
    else if (channel.visibility === "private") next.private.push(channel);
    else next.public.push(channel);
  }
  for (const key of ["starred", "public", "private"] as const) {
    next[key].sort((a, b) => a.slug.localeCompare(b.slug));
  }
  return next;
}

export function ChannelSections({
  groups,
  orgSlug,
  activeChannelSlug,
  canManage,
  canCreate,
}: ChannelSectionsProps) {
  const router = useRouter();
  const [current, setCurrent] = useState(groups);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);

  useEffect(() => setCurrent(groups), [groups]);
  useEffect(() => setCollapsed(readCollapsed()), []);

  function setOpen(key: string, open: boolean) {
    setCollapsed((previous) => {
      const next = { ...previous, [key]: !open };
      writeCollapsed(next);
      return next;
    });
  }

  async function toggleStar(channel: Channel) {
    const optimistic = { ...channel, starred: !channel.starred };
    setCurrent((previous) => regroup(previous, optimistic));
    try {
      const result = await trpc.channels.toggleStar.mutate({
        projectId: channel.id,
      });
      setCurrent((previous) =>
        regroup(previous, { ...channel, starred: result.starred }),
      );
    } catch {
      setCurrent((previous) => regroup(previous, channel));
    }
  }

  async function changeVisibility(channel: Channel, visibility: string) {
    if (channel.visibility === visibility) return;

    setCurrent((previous) => regroup(previous, { ...channel, visibility }));
    try {
      const result = await trpc.channels.update.mutate({
        projectId: channel.id,
        visibility: visibility === "private" ? "private" : "public",
      });
      setCurrent((previous) =>
        regroup(previous, { ...channel, visibility: result.visibility }),
      );
      router.refresh();
    } catch {
      setCurrent((previous) => regroup(previous, channel));
    }
  }

  return (
    <div className="flex w-full min-w-0 flex-col">
      {SECTIONS.map((section) => (
        <ChannelSection
          key={section.key}
          label={section.label}
          channels={current[section.key]}
          open={collapsed[section.key] !== true}
          orgSlug={orgSlug}
          activeChannelSlug={activeChannelSlug}
          canManage={canManage}
          onOpenChange={(open) => setOpen(section.key, open)}
          onToggleStar={toggleStar}
          onChangeVisibility={changeVisibility}
          onCreate={
            section.key === "private" && canCreate
              ? () => setCreating(true)
              : undefined
          }
        />
      ))}
      <CreateChannelDialog
        open={creating}
        onOpenChange={setCreating}
        channels={[...current.starred, ...current.public, ...current.private]}
        orgSlug={orgSlug}
      />
    </div>
  );
}

import { getChannelBySlug, listAgents, normalizeVisibility } from "@roster/api";
import { Button } from "@roster/ui";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "~/components/app-shell/app-shell";
import { ChannelSettings } from "~/components/channels/channel-settings";
import { ChannelMark } from "~/components/logo/channel-mark";
import { loadShell } from "~/lib/shell";

export default async function ChannelSettingsPage({
  params,
}: {
  params: Promise<{ slug: string; channelSlug: string }>;
}) {
  const { slug, channelSlug } = await params;
  const { organization, member, shell } = await loadShell(slug);

  const channel = await getChannelBySlug({
    organizationId: organization.id,
    memberId: member.id,
    role: member.role,
    slug: channelSlug,
  });
  if (!channel) notFound();

  const agents = await listAgents({
    organizationId: organization.id,
    memberId: member.id,
    role: member.role,
  });

  const channelPath = `/${organization.slug}/${channel.slug}`;

  return (
    <AppShell
      shell={shell}
      section="channels"
      activeChannelSlug={channel.slug}
      title={
        <span className="flex min-w-0 items-center gap-2">
          <ChannelMark className="text-muted-foreground" />
          <span className="truncate">{channel.slug}</span>
          <span className="text-muted-foreground shrink-0">/ Settings</span>
        </span>
      }
      actions={
        <Button variant="ghost" className="!rounded-md gap-1" asChild>
          <Link href={channelPath}>
            <ChevronLeft size={14} />
            Back
          </Link>
        </Button>
      }
    >
      <ChannelSettings
        projectId={channel.id}
        name={channel.name}
        slug={channel.slug}
        defaultAgentId={channel.defaultAgentId}
        agents={agents.map((agent) => ({
          id: agent.id,
          handle: agent.handle,
          folderName: agent.folderName,
        }))}
        visibility={normalizeVisibility(channel.visibility)}
        canManage={shell.can("channel:update")}
      />
    </AppShell>
  );
}

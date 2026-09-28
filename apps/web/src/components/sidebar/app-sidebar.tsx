import { CircleCheck, MessagesSquare, Users } from "lucide-react";

import type { Shell } from "~/lib/shell";
import type { SidebarSection } from "~/types";

import { ChannelSections } from "./channel-sections";
import { SidebarLink } from "./sidebar-link";
import { WorkspaceMenu } from "./workspace-menu";

export interface AppSidebarProps {
  shell: Shell;
  section: SidebarSection;
  activeChannelSlug?: string;
}

export function AppSidebar({
  shell,
  section,
  activeChannelSlug,
}: AppSidebarProps) {
  const { organization, organizations, user, channels } = shell;

  return (
    <aside className="bg-background flex h-full w-full shrink-0 flex-col gap-3 p-2 md:w-56">
      <WorkspaceMenu
        activeOrg={organization}
        organizations={organizations}
        user={user}
      />

      <nav className="overscroll-contain flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        <div className="flex w-full min-w-0 flex-col gap-0.5">
          <SidebarLink
            href={`/${organization.slug}/threads`}
            active={section === "threads"}
            icon={<MessagesSquare size={14} />}
            label="Threads"
          />
          <SidebarLink
            href={`/${organization.slug}/tasks`}
            active={section === "tasks"}
            icon={<CircleCheck size={14} />}
            label="Tasks"
          />
          <SidebarLink
            href={`/${organization.slug}/settings/members`}
            active={section === "members"}
            icon={<Users size={14} />}
            label="Members"
          />
        </div>

        <ChannelSections
          groups={channels}
          orgSlug={organization.slug}
          activeChannelSlug={activeChannelSlug}
          canManage={shell.can("channel:update")}
          canCreate={shell.can("channel:create")}
        />
      </nav>
    </aside>
  );
}

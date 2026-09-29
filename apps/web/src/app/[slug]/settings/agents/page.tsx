import { listAgents, listOrgFolders } from "@roster/api";

import { AgentManager } from "~/components/agents/agent-manager";
import { SettingsPage } from "~/components/settings/settings-page";
import { loadShell } from "~/lib/shell";

export default async function AgentsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { organization, member } = await loadShell(slug);

  const [agents, folders] = await Promise.all([
    listAgents({
      organizationId: organization.id,
      memberId: member.id,
      role: member.role,
    }),
    listOrgFolders(organization.id),
  ]);

  return (
    <SettingsPage
      title="Agents"
      description="Who you can call on, and which folder each one works in."
    >
      <AgentManager
        agents={agents}
        folders={folders.map((folder) => ({ id: folder.id, name: folder.name }))}
      />
    </SettingsPage>
  );
}

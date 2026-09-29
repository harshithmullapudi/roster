import { ChannelPicker } from "~/components/channels/channel-picker";
import {
  SettingsPage,
  SettingsSection,
} from "~/components/settings/settings-page";
import { SupersetConnectionSettings } from "~/components/settings/superset-connection";

export default function HostsPage() {
  return (
    <SettingsPage
      title="Hosts & folders"
      description="Your machines, and the folders on them that this workspace works in."
    >
      <SettingsSection title="Superset">
        <SupersetConnectionSettings />
      </SettingsSection>

      <SettingsSection
        title="Folders"
        description="Tick a project to add it as a folder. Each new folder arrives with an agent and a channel of its own; the ones already added are marked."
      >
        <ChannelPicker addLabel="Add folders" />
      </SettingsSection>
    </SettingsPage>
  );
}

export const ORG_ROLES = ["owner", "admin", "member"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const CAPABILITIES = [
  "channel:create",
  "channel:update",
  "member:invite",
  "member:remove",
  "member:role",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

const ROLE_CAPABILITIES: Record<OrgRole, readonly Capability[]> = {
  owner: CAPABILITIES,
  admin: CAPABILITIES,
  member: [],
};

export function normalizeRole(role: string | null | undefined): OrgRole {
  return ORG_ROLES.includes(role as OrgRole) ? (role as OrgRole) : "member";
}

export function can(
  role: string | null | undefined,
  capability: Capability,
): boolean {
  return ROLE_CAPABILITIES[normalizeRole(role)].includes(capability);
}

export function capabilitiesFor(
  role: string | null | undefined,
): readonly Capability[] {
  return ROLE_CAPABILITIES[normalizeRole(role)];
}

import {
  db,
  folders,
  members,
  type SelectFolder,
  type SelectMember,
} from "@roster/db";
import { mintJwt, routingKey, tryDecryptApiKey } from "@roster/superset";
import { and, eq } from "drizzle-orm";

import { createJwtCache } from "../../lib/jwt-cache";

const jwts = createJwtCache(async (apiKey) => {
  const { jwt, claims } = await mintJwt(apiKey);
  return { jwt, exp: claims.exp };
});

export function forgetSupersetCredentials(): void {
  jwts.clear();
}

export interface HostConnection {
  jwt: string;
  folder: SelectFolder;
  hostKey: string;
  memberId: string;
}

export type MemberAuth = { jwt: string } | { jwt: null; problem: string };

export const NO_MEMBER =
  "This run has nobody to run as, so there is no Superset key to reach the machine with.";
export const NOT_CONNECTED =
  "You have not connected Superset. Connect it in settings to reach your machines.";
export const UNREADABLE_KEY =
  "Your stored Superset key can no longer be read. Reconnect Superset in settings.";
export const OTHER_ORG =
  "Your Superset connection is to a different organization than this folder's machine. Switch it in settings.";

export type MemberKey = { apiKey: string } | { apiKey: null; problem: string };

type KeyHolder = Pick<SelectMember, "supersetKeyEncrypted" | "supersetOrgId">;

export function memberKey(
  member: KeyHolder | null | undefined,
  supersetOrgId: string,
): MemberKey {
  if (!member) return { apiKey: null, problem: NO_MEMBER };
  if (!member.supersetKeyEncrypted) {
    return { apiKey: null, problem: NOT_CONNECTED };
  }
  if (member.supersetOrgId !== supersetOrgId) {
    return { apiKey: null, problem: OTHER_ORG };
  }

  const apiKey = tryDecryptApiKey(member.supersetKeyEncrypted);
  if (!apiKey) return { apiKey: null, problem: UNREADABLE_KEY };

  return { apiKey };
}

export async function hostConnection(args: {
  organizationId: string;
  agentMemberId: string;
  asMemberId?: string | null;
  supersetHostKey?: string | null;
}): Promise<HostConnection> {
  const agent = await db.query.members.findFirst({
    where: and(
      eq(members.id, args.agentMemberId),
      eq(members.organizationId, args.organizationId),
    ),
  });
  if (!agent?.folderId) {
    throw new Error("This agent is no longer linked to a folder.");
  }

  const folder = await db.query.folders.findFirst({
    where: eq(folders.id, agent.folderId),
  });
  if (!folder) throw new Error("This agent is no longer linked to a folder.");

  const keyHolderId = args.asMemberId ?? folder.ownerMemberId;
  if (!keyHolderId) throw new Error(NO_MEMBER);

  const member = await db.query.members.findFirst({
    where: and(
      eq(members.id, keyHolderId),
      eq(members.organizationId, args.organizationId),
    ),
  });

  const key = memberKey(member, folder.supersetOrgId);
  if (key.apiKey === null) throw new Error(key.problem);

  return {
    jwt: await jwts.get(key.apiKey),
    folder,
    hostKey:
      args.supersetHostKey ??
      routingKey(folder.supersetOrgId, folder.supersetHostId),
    memberId: member!.id,
  };
}

export async function jwtForMember(args: {
  memberId: string;
  hostKey: string;
}): Promise<MemberAuth> {
  const [supersetOrgId] = args.hostKey.split(":");
  if (!supersetOrgId) return { jwt: null, problem: NO_MEMBER };

  const member = await db.query.members.findFirst({
    where: eq(members.id, args.memberId),
  });

  const key = memberKey(member, supersetOrgId);
  if (key.apiKey === null) return { jwt: null, problem: key.problem };

  return { jwt: await jwts.get(key.apiKey) };
}

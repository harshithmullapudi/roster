import { relations } from "drizzle-orm";

import {
  invitations,
  members,
  organizations,
  sessions,
  users,
} from "./auth";
import { folders, projects } from "./roster";

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  members: many(members),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const organizationsRelations = relations(organizations, ({ many }) => ({
  members: many(members),
  invitations: many(invitations),
  projects: many(projects),
}));

export const projectsRelations = relations(projects, ({ one }) => ({
  organization: one(organizations, {
    fields: [projects.organizationId],
    references: [organizations.id],
  }),
  defaultAgent: one(members, {
    fields: [projects.defaultAgentId],
    references: [members.id],
  }),
  addedBy: one(members, {
    fields: [projects.addedByMemberId],
    references: [members.id],
  }),
}));

export const foldersRelations = relations(folders, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [folders.organizationId],
    references: [organizations.id],
  }),
  owner: one(members, {
    fields: [folders.ownerMemberId],
    references: [members.id],
  }),
  agents: many(members),
}));

export const membersRelations = relations(members, ({ one }) => ({
  organization: one(organizations, {
    fields: [members.organizationId],
    references: [organizations.id],
  }),
  folder: one(folders, {
    fields: [members.folderId],
    references: [folders.id],
  }),
  user: one(users, { fields: [members.userId], references: [users.id] }),
}));

export const invitationsRelations = relations(invitations, ({ one }) => ({
  organization: one(organizations, {
    fields: [invitations.organizationId],
    references: [organizations.id],
  }),
  inviter: one(users, {
    fields: [invitations.inviterId],
    references: [users.id],
  }),
}));

import { bigint, integer, pgSchema, primaryKey, text } from "drizzle-orm/pg-core";

export const workspace = pgSchema("permitline_dashboard");
const timestamp = (name: string) => bigint(name, { mode: "number" });
export const accounts = workspace.table("workspace_accounts", {
  userId: text("user_id").primaryKey(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockUntil: timestamp("lock_until").notNull().default(0),
  createdAt: timestamp("created_at").notNull(),
}).enableRLS();
export const sessions = workspace.table("workspace_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
}).enableRLS();
export const preferences = workspace.table("workspace_preferences", {
  userId: text("user_id").primaryKey(),
  payload: text("payload").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
}).enableRLS();
export const leadStates = workspace.table("lead_states", {
  userId: text("user_id").notNull(),
  permitId: text("permit_id").notNull(),
  status: text("status").notNull().default("new"),
  notes: text("notes").notNull().default(""),
  updatedAt: timestamp("updated_at").notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.permitId] })]).enableRLS();
export const assessments = workspace.table("jev_assessments", {
  userId: text("user_id").notNull(),
  permitId: text("permit_id").notNull(),
  inputHash: text("input_hash").notNull(),
  payload: text("payload").notNull(),
  createdAt: timestamp("created_at").notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.permitId] })]).enableRLS();

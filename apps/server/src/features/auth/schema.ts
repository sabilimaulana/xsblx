import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * D1 is SQLite (ADR 0020): there is no `boolean` and no `timestamp` column type.
 * Booleans are `integer({ mode: "boolean" })` and instants are
 * `integer({ mode: "timestamp_ms" })`, which drizzle maps to `boolean` and `Date`
 * on both sides — the shape Better Auth's adapter reads and writes.
 *
 * Defaults are `$defaultFn` rather than SQL defaults, because SQLite's
 * `unixepoch()` yields seconds and the millisecond value is what the column
 * stores.
 */
const now = () => /* @__PURE__ */ new Date();

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).default(false).notNull(),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(now).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .$defaultFn(now)
    .$onUpdate(now)
    .notNull(),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(now).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).$onUpdate(now).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    issuer: text("issuer").notNull(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(now).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).$onUpdate(now).notNull(),
  },
  (table) => [
    uniqueIndex("account_issuer_accountId_uidx").on(table.issuer, table.accountId),
    index("account_userId_idx").on(table.userId),
  ],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(now).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$defaultFn(now)
      .$onUpdate(now)
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

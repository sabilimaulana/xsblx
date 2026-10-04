import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * The yielded subject. Native to yielded-auth (no Better Auth lineage):
 * identity (`id`), profile (`displayName`), liveness (`status`) and the
 * security revision sessions bind to. The login email lives ONLY in
 * yielded's identifiers table — this row never stores it, so there is no
 * dual-write to drift. Email verification state, when it exists, will live
 * on the identifier (`verified_at`), not here.
 *
 * D1 is SQLite (ADR 0020): instants are `integer({ mode: "timestamp_ms" })`.
 * Defaults are `$defaultFn` rather than SQL defaults, because SQLite's
 * `unixepoch()` yields seconds and the millisecond value is what the column
 * stores.
 */
const now = () => /* @__PURE__ */ new Date();

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  /**
   * Subject liveness: `"active"` admits sign-in, anything else does not.
   */
  status: text("status").default("active").notNull(),
  /**
   * Per-user security revision. Rotated on password change; sessions bound
   * to an older revision stop verifying.
   */
  securityRevision: text("security_revision"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(now).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .$defaultFn(now)
    .$onUpdate(now)
    .notNull(),
});

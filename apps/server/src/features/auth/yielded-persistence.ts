import {
  createPersistence,
  makeComposedPasskeys,
  makeNativeSqlTables,
  PersistenceConfigurationError,
} from "@yielded/auth-persistence/Adapter";
import type { QueryOperations, StorageTable } from "@yielded/auth-persistence/Adapter";
import {
  and,
  asc,
  eq,
  getTableColumns,
  gt,
  gte,
  inArray,
  isNull,
  lte,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import type { AnyColumn, SQL } from "drizzle-orm";
import {
  getTableConfig,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { Context, Effect } from "effect";

import { AppAuth } from "./yielded-auth.ts";
import { Db } from "../../db/index.ts";

/**
 * D1 backend for yielded-auth.
 *
 * Upstream ships this composition only for its SQLite drivers
 * (`sqlitePersistence` in `@yielded/auth-persistence-drizzle` internals);
 * the D1 driver exposes per-workflow factories instead, with no example
 * wiring them. This file mirrors the SQLite composition for D1 — same
 * kernels, same table shapes, D1 acquire. If yielded gains a D1 `managed`
 * helper, delete this file and use it.
 *
 * Table shapes (`makeTable`/`describe`) and the D1 statement helpers match
 * upstream's SQLite versions field for field; `operations` is drizzle
 * operators plus two small local helpers.
 */

/**
 * Indexes the hand-written ports query by, beyond yielded's unique keys.
 * `SessionRepository.list` and `revokeAll` filter sessions by subject.
 */
const portIndexes: Readonly<Record<string, ReadonlyArray<readonly [string, ...Array<string>]>>> = {
  xsblx_auth_sessions: [["subjectId", "sessionId"]],
};

const makeTable = (definition: StorageTable) =>
  sqliteTable(
    definition.name,
    Object.fromEntries(
      Object.entries(definition.columns).map(([key, column]) => {
        const builder =
          column.type === "text"
            ? text(column.name)
            : column.type === "boolean"
              ? integer(column.name, { mode: "boolean" })
              : integer(column.name);
        return [key, column.nullable ? builder : builder.notNull()];
      }),
    ),
    (columns) => {
      const resolve = (key: string) => {
        const column = columns[key];
        if (column === undefined) {
          throw PersistenceConfigurationError.make({ reason: "An empty unique key is invalid" });
        }
        return column;
      };
      return [
        ...definition.unique.map((keys, i) => {
          const [first, ...rest] = keys;
          if (first === undefined) {
            throw PersistenceConfigurationError.make({ reason: "An empty unique key is invalid" });
          }
          return uniqueIndex(`${definition.name}_key_${i}`).on(
            resolve(first),
            ...rest.map(resolve),
          );
        }),
        ...(portIndexes[definition.name] ?? []).map(([first, ...rest], i) =>
          index(`${definition.name}_idx_${i}`).on(resolve(first), ...rest.map(resolve)),
        ),
      ];
    },
  );

const describe = (table: SQLiteTable): StorageTable => {
  const config = getTableConfig(table);
  return {
    name: config.name,
    columns: Object.fromEntries(
      Object.entries(getTableColumns(table)).map(([key, column]) => [
        key,
        {
          name: column.name,
          type:
            column.dataType === "boolean"
              ? "boolean"
              : column.dataType === "number"
                ? "integer"
                : "text",
          nullable: !column.notNull,
        },
      ]),
    ),
    unique: [],
  };
};

const columnOf = (table: object, key: string): AnyColumn => {
  const columns = getTableColumns(table as Parameters<typeof getTableColumns>[0]);
  return columns[key] as AnyColumn;
};

const operations = {
  and,
  asc,
  or,
  eq,
  gt,
  gte,
  lte,
  inArray,
  isNull,
  notExists,
  sql,
  getTableColumns,
  column: columnOf,
  updateValues: (entries: ReadonlyArray<readonly [string, unknown]>) =>
    Object.fromEntries(entries) as Record<string, unknown>,
  balancedD1And: (...conditions: ReadonlyArray<SQL | undefined>): SQL | undefined => {
    const parts = conditions.filter((condition) => condition !== undefined);
    const join = (start: number, end: number): SQL => {
      if (end - start === 1) return sql`(${parts[start]!})`;
      const middle = start + Math.floor((end - start) / 2);
      return sql`(${join(start, middle)} and ${join(middle, end)})`;
    };
    return parts.length === 0 ? undefined : join(0, parts.length);
  },
  compactD1GeneratedStatement: <A extends object>(_client: unknown, statement: A): A => statement,
} as unknown as QueryOperations<SQL, AnyColumn>;

const Persistence = createPersistence<SQLiteTable, Db>({
  makeTable,
  describe,
  operations,
  // Only the interactive-transaction kernels read native tables, and no
  // assembly here builds them (see `yielded-live.ts`); the default mapping
  // satisfies the backend contract.
  nativeTables: (client) => makeNativeSqlTables(client),
  acquire: Effect.map(Effect.context<Db>(), (ctx) => Context.get(ctx, Db)),
  passkeys: makeComposedPasskeys(operations),
});

export const BoundPersistence = Persistence.make(AppAuth);

export { AppAuth, Persistence };

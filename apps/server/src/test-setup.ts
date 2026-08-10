import { afterAll, beforeEach } from "vitest";
import { disposeTestDb, migrateTestDb, resetTestDb } from "./test-db.ts";

// ponytail: migrating per test file relies on `fileParallelism: false` to avoid
// two files racing the migration table. Move this to a `globalSetup` (or give
// each worker its own schema) when the suite is big enough to want parallelism.
await migrateTestDb();

beforeEach(resetTestDb);
afterAll(disposeTestDb);

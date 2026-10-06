import { drizzle } from "drizzle-orm/postgres-js";
import { databaseClient } from "../scripts/database-client.mjs";
import * as schema from "./schema";

let database: ReturnType<typeof createDatabase> | undefined;
function createDatabase() {
  const client = databaseClient();
  return drizzle(client, { schema });
}
export function getDb() { return database ??= createDatabase(); }

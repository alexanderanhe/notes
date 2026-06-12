import { MongoClient, type Db } from "mongodb";

import { getEnv } from "./env.server";
import { logSafe } from "~/lib/security.server";

declare global {
  var __notesMongoClientPromise: Promise<MongoClient> | undefined;
}

let productionClientPromise: Promise<MongoClient> | undefined;

function createClientPromise() {
  const client = new MongoClient(getEnv("MONGODB_URI"));
  return client.connect().catch((error) => {
    logSafe("error", "mongodb_connection_failed", { error });
    throw error;
  });
}

export async function getDb(): Promise<Db> {
  const clientPromise =
    process.env.NODE_ENV === "production"
      ? (productionClientPromise ??= createClientPromise())
      : (global.__notesMongoClientPromise ??= createClientPromise());

  const client = await clientPromise;
  return client.db();
}

import { type Collection, ObjectId, type WithId } from "mongodb";
import { z } from "zod";

import { getDb } from "~/lib/auth/db.server";
import {
  MAX_FOLDER_DEPTH,
  MAX_FOLDERS,
  type EncryptedFolder,
  type EncryptedFolderInput,
  type FolderDeleteStrategy,
} from "~/lib/folders";

interface FolderDocument extends EncryptedFolderInput {
  userId: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const base64 = (maximum: number) => z.string().min(4).max(maximum).regex(/^[A-Za-z0-9+/]+={0,2}$/);
const iv = base64(24).refine((value) => atob(value).length === 12);
const folderSchema = z.object({
  parentFolderId: z.string().nullable(),
  encryptedName: base64(16_000),
  nameIv: iv,
  encryptedIcon: base64(4_000),
  iconIv: iv,
  encryptedColor: base64(4_000),
  colorIv: iv,
  sortOrder: z.number().int().min(-100_000).max(100_000),
}).strict();

let indexesReady: Promise<string> | undefined;

async function foldersCollection(): Promise<Collection<FolderDocument>> {
  const collection = (await getDb()).collection<FolderDocument>("folders");
  indexesReady ??= collection.createIndex({ userId: 1, parentFolderId: 1, sortOrder: 1 });
  await indexesReady;
  return collection;
}

export function parseEncryptedFolderInput(value: unknown) {
  const parsed = folderSchema.safeParse(value);
  if (!parsed.success) throw new Response("Invalid encrypted folder.", { status: 400 });
  return parsed.data;
}

function serialize(folder: WithId<FolderDocument>): EncryptedFolder {
  const { _id, userId: _userId, createdAt, updatedAt, ...encrypted } = folder;
  return { id: _id.toHexString(), ...encrypted, createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString() };
}

export async function listEncryptedFolders(userId: ObjectId) {
  return (await (await foldersCollection()).find({ userId }).sort({ sortOrder: 1, createdAt: 1 }).toArray()).map(serialize);
}

export async function createEncryptedFolder(userId: ObjectId, input: EncryptedFolderInput) {
  const collection = await foldersCollection();
  if (await collection.countDocuments({ userId }, { limit: MAX_FOLDERS }) >= MAX_FOLDERS) {
    throw new Response("Folder limit reached.", { status: 400 });
  }
  await assertValidParent(userId, input.parentFolderId);
  const now = new Date();
  const result = await collection.insertOne({ ...input, userId, createdAt: now, updatedAt: now });
  return serialize((await collection.findOne({ _id: result.insertedId, userId }))!);
}

export async function updateEncryptedFolder(userId: ObjectId, folderId: string, input: EncryptedFolderInput) {
  if (!ObjectId.isValid(folderId)) return null;
  await assertValidParent(userId, input.parentFolderId, folderId);
  const folder = await (await foldersCollection()).findOneAndUpdate(
    { _id: new ObjectId(folderId), userId },
    { $set: { ...input, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  return folder ? serialize(folder) : null;
}

export async function moveEncryptedFolder(userId: ObjectId, folderId: string, parentFolderId: string | null) {
  if (!ObjectId.isValid(folderId)) return null;
  await assertValidParent(userId, parentFolderId, folderId);
  const folder = await (await foldersCollection()).findOneAndUpdate(
    { _id: new ObjectId(folderId), userId },
    { $set: { parentFolderId, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  return folder ? serialize(folder) : null;
}

export async function deleteEncryptedFolder(userId: ObjectId, folderId: string, strategy: FolderDeleteStrategy) {
  if (!ObjectId.isValid(folderId)) return false;
  const collection = await foldersCollection();
  const folder = await collection.findOne({ _id: new ObjectId(folderId), userId });
  if (!folder) return false;
  const db = await getDb();
  const items = db.collection<{ userId: ObjectId; folderId?: string | null; archived: boolean }>("vaultItems");
  const notes = db.collection<{ userId: ObjectId; folderId?: string | null; archived: boolean }>("notes");
  const destination = strategy === "move-to-parent" ? folder.parentFolderId : null;
  if (strategy === "archive-items") {
    await Promise.all([
      items.updateMany({ userId, folderId }, { $set: { archived: true, folderId: null, updatedAt: new Date() } }),
      notes.updateMany({ userId, folderId }, { $set: { archived: true, folderId: null, updatedAt: new Date() } }),
    ]);
  } else {
    await Promise.all([
      items.updateMany({ userId, folderId }, { $set: { folderId: destination, updatedAt: new Date() } }),
      notes.updateMany({ userId, folderId }, { $set: { folderId: destination, updatedAt: new Date() } }),
    ]);
  }
  await collection.updateMany({ userId, parentFolderId: folderId }, { $set: { parentFolderId: destination, updatedAt: new Date() } });
  return (await collection.deleteOne({ _id: folder._id, userId })).deletedCount === 1;
}

async function assertValidParent(userId: ObjectId, parentFolderId: string | null, movingFolderId?: string) {
  if (parentFolderId === null) return;
  if (!ObjectId.isValid(parentFolderId) || parentFolderId === movingFolderId) {
    throw new Response("Invalid parent folder.", { status: 400 });
  }
  const collection = await foldersCollection();
  let current: string | null = parentFolderId;
  let depth = 1;
  const visited = new Set<string>(movingFolderId ? [movingFolderId] : []);
  while (current) {
    if (visited.has(current)) throw new Response("Folder cycles are not allowed.", { status: 400 });
    visited.add(current);
    const parent: WithId<FolderDocument> | null = await collection.findOne({ _id: new ObjectId(current), userId });
    if (!parent) throw new Response("Parent folder not found.", { status: 404 });
    current = parent.parentFolderId;
    depth += 1;
    if (depth > MAX_FOLDER_DEPTH) throw new Response("Folder depth limit reached.", { status: 400 });
  }
}

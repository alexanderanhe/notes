import { type Collection, ObjectId, type WithId } from "mongodb";
import { z } from "zod";

import { getDb } from "~/lib/auth/db.server";
import {
  VAULT_ITEM_ENCRYPTION_VERSION,
  VAULT_ITEM_TYPES,
  type EncryptedVaultItem,
  type EncryptedVaultItemInput,
} from "~/lib/vault-items";

interface VaultItemDocument extends EncryptedVaultItemInput {
  userId: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

let indexesReady: Promise<string> | undefined;

async function vaultItemsCollection(): Promise<Collection<VaultItemDocument>> {
  const collection = (await getDb()).collection<VaultItemDocument>("vaultItems");
  indexesReady ??= collection.createIndex({ userId: 1, type: 1, updatedAt: -1 });
  await indexesReady;
  return collection;
}

const base64 = (maximum: number) =>
  z.string().min(4).max(maximum).regex(/^[A-Za-z0-9+/]+={0,2}$/);
const iv = base64(24).refine((value) => atob(value).length === 12);

const encryptedVaultItemSchema = z.object({
  type: z.enum(VAULT_ITEM_TYPES),
  folderId: z.string().nullable(),
  encryptedTitle: base64(64_000),
  titleIv: iv,
  encryptedPayload: base64(8_000_000),
  payloadIv: iv,
  encryptedSearchText: base64(8_000_000),
  searchTextIv: iv,
  tagsEncrypted: base64(256_000),
  tagsIv: iv,
  favorite: z.boolean(),
  archived: z.boolean(),
  pinned: z.boolean(),
  encryptionVersion: z.literal(VAULT_ITEM_ENCRYPTION_VERSION),
}).strict();

const encryptedTagsSchema = z.object({
  tagsEncrypted: base64(256_000),
  tagsIv: iv,
  encryptedSearchText: base64(8_000_000),
  searchTextIv: iv,
}).strict();

export function parseEncryptedVaultItemInput(value: unknown) {
  const parsed = encryptedVaultItemSchema.safeParse(value);
  if (!parsed.success) throw new Response("Invalid encrypted payload.", { status: 400 });
  return parsed.data;
}

export function parseEncryptedTagsInput(value: unknown) {
  const parsed = encryptedTagsSchema.safeParse(value);
  if (!parsed.success) throw new Response("Invalid encrypted tags.", { status: 400 });
  return parsed.data;
}

function serialize(item: WithId<VaultItemDocument>): EncryptedVaultItem {
  const { _id, userId: _userId, createdAt, updatedAt, folderId, ...encrypted } = item;
  return {
    id: _id.toHexString(),
    ...encrypted,
    folderId: folderId ?? null,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
}

export async function listEncryptedVaultItems(userId: ObjectId) {
  return (await (await vaultItemsCollection()).find({ userId }).sort({ pinned: -1, updatedAt: -1 }).toArray()).map(serialize);
}

export async function createEncryptedVaultItem(userId: ObjectId, input: EncryptedVaultItemInput) {
  await assertOwnedFolder(userId, input.folderId);
  const now = new Date();
  const collection = await vaultItemsCollection();
  const result = await collection.insertOne({ ...input, userId, createdAt: now, updatedAt: now });
  return serialize((await collection.findOne({ _id: result.insertedId, userId }))!);
}

export async function getEncryptedVaultItem(userId: ObjectId, itemId: string) {
  if (!ObjectId.isValid(itemId)) return null;
  const item = await (await vaultItemsCollection()).findOne({ _id: new ObjectId(itemId), userId });
  return item ? serialize(item) : null;
}

export async function updateEncryptedVaultItem(userId: ObjectId, itemId: string, input: EncryptedVaultItemInput) {
  if (!ObjectId.isValid(itemId)) return null;
  await assertOwnedFolder(userId, input.folderId);
  const item = await (await vaultItemsCollection()).findOneAndUpdate(
    { _id: new ObjectId(itemId), userId },
    { $set: { ...input, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  return item ? serialize(item) : null;
}

export async function deleteEncryptedVaultItem(userId: ObjectId, itemId: string) {
  if (!ObjectId.isValid(itemId)) return false;
  return (await (await vaultItemsCollection()).deleteOne({ _id: new ObjectId(itemId), userId })).deletedCount === 1;
}

export async function setVaultItemFolder(userId: ObjectId, itemId: string, folderId: string | null) {
  if (!ObjectId.isValid(itemId)) return null;
  await assertOwnedFolder(userId, folderId);
  const item = await (await vaultItemsCollection()).findOneAndUpdate(
    { _id: new ObjectId(itemId), userId },
    { $set: { folderId, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  return item ? serialize(item) : null;
}

export async function setVaultItemFlag(
  userId: ObjectId,
  itemId: string,
  field: "favorite" | "archived",
  value: boolean,
) {
  if (!ObjectId.isValid(itemId)) return null;
  const item = await (await vaultItemsCollection()).findOneAndUpdate(
    { _id: new ObjectId(itemId), userId },
    { $set: { [field]: value, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  return item ? serialize(item) : null;
}

export async function setVaultItemEncryptedTags(
  userId: ObjectId,
  itemId: string,
  input: z.infer<typeof encryptedTagsSchema>,
) {
  if (!ObjectId.isValid(itemId)) return null;
  const item = await (await vaultItemsCollection()).findOneAndUpdate(
    { _id: new ObjectId(itemId), userId },
    { $set: { ...input, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  return item ? serialize(item) : null;
}

async function assertOwnedFolder(userId: ObjectId, folderId: string | null) {
  if (folderId === null) return;
  if (!ObjectId.isValid(folderId)) throw new Response("Invalid folder.", { status: 400 });
  const folder = await (await getDb()).collection<{ userId: ObjectId }>("folders").findOne({
    _id: new ObjectId(folderId),
    userId,
  });
  if (!folder) throw new Response("Folder not found.", { status: 404 });
}

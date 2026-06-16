import { type Collection, ObjectId, type WithId } from "mongodb";
import { z } from "zod";

import { getDb } from "~/lib/auth/db.server";
import {
  VAULT_ITEM_ENCRYPTION_VERSION,
  VAULT_ITEM_TYPES,
  type EncryptedVaultItem,
  type EncryptedVaultItemInput,
  type VaultItemEvent,
  type VaultItemEventType,
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
  encryptedItemNotes: base64(2_000_000).optional(),
  itemNotesIv: iv.optional(),
  tagsEncrypted: base64(256_000),
  tagsIv: iv,
  favorite: z.boolean(),
  archived: z.boolean(),
  pinned: z.boolean(),
  requiresRecent2FA: z.boolean().default(false),
  hasExtraPassword: z.boolean().default(false),
  extraPasswordSalt: z
    .string()
    .regex(/^[A-Za-z0-9+/]+={0,2}$/)
    .optional(),
  extraPasswordEncryptedItemKey: base64(1_024).optional(),
  extraPasswordItemKeyIv: iv.optional(),
  encryptionVersion: z.literal(VAULT_ITEM_ENCRYPTION_VERSION),
}).strict().superRefine((input, context) => {
  const fields = [
    input.extraPasswordSalt,
    input.extraPasswordEncryptedItemKey,
    input.extraPasswordItemKeyIv,
  ];
  if (
    (input.hasExtraPassword && fields.some((field) => !field)) ||
    (!input.hasExtraPassword && fields.some((field) => field !== undefined))
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Extra password metadata is inconsistent.",
      path: ["hasExtraPassword"],
    });
  }
  if (Boolean(input.encryptedItemNotes) !== Boolean(input.itemNotesIv)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Item notes metadata is inconsistent.",
      path: ["encryptedItemNotes"],
    });
  }
});

const encryptedTagsSchema = z.object({
  tagsEncrypted: base64(256_000),
  tagsIv: iv,
  encryptedSearchText: base64(8_000_000),
  searchTextIv: iv,
  tagCount: z.number().int().min(0).max(500).optional(),
}).strict();

const encryptedItemNotesSchema = z.object({
  encryptedItemNotes: base64(2_000_000),
  itemNotesIv: iv,
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

export function parseEncryptedItemNotesInput(value: unknown) {
  const parsed = encryptedItemNotesSchema.safeParse(value);
  if (!parsed.success) throw new Response("Invalid encrypted item notes.", { status: 400 });
  return parsed.data;
}

function serialize(item: WithId<VaultItemDocument>): EncryptedVaultItem {
  const { _id, userId: _userId, createdAt, updatedAt, folderId, ...encrypted } = item;
  return {
    id: _id.toHexString(),
    ...encrypted,
    hasExtraPassword: encrypted.hasExtraPassword ?? false,
    requiresRecent2FA: encrypted.requiresRecent2FA ?? false,
    folderId: folderId ?? null,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
}

export async function listEncryptedVaultItems(userId: ObjectId) {
  const collection = await vaultItemsCollection();
  await migrateNoteItemsToDocuments(collection, userId);
  return (await collection.find({ userId }).sort({ pinned: -1, updatedAt: -1 }).toArray()).map(serialize);
}

export async function createEncryptedVaultItem(userId: ObjectId, input: EncryptedVaultItemInput) {
  await assertOwnedFolder(userId, input.folderId);
  const now = new Date();
  const collection = await vaultItemsCollection();
  const result = await collection.insertOne({ ...input, userId, createdAt: now, updatedAt: now });
  await recordVaultItemEvent(userId, result.insertedId, "item.created");
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
  const collection = await vaultItemsCollection();
  const before = await collection.findOne({ _id: new ObjectId(itemId), userId });
  if (!before) return null;
  const item = await collection.findOneAndUpdate(
    { _id: new ObjectId(itemId), userId },
    { $set: { ...input, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (item) {
    await recordVaultItemUpdateEvents(userId, item._id, before, item);
  }
  return item ? serialize(item) : null;
}

export async function deleteEncryptedVaultItem(userId: ObjectId, itemId: string) {
  if (!ObjectId.isValid(itemId)) return false;
  const id = new ObjectId(itemId);
  const result = await (await vaultItemsCollection()).deleteOne({ _id: id, userId });
  if (result.deletedCount === 1) await recordVaultItemEvent(userId, id, "item.deleted");
  return result.deletedCount === 1;
}

export async function setVaultItemFolder(userId: ObjectId, itemId: string, folderId: string | null) {
  if (!ObjectId.isValid(itemId)) return null;
  await assertOwnedFolder(userId, folderId);
  const collection = await vaultItemsCollection();
  const before = await collection.findOne({ _id: new ObjectId(itemId), userId });
  const item = await collection.findOneAndUpdate(
    { _id: new ObjectId(itemId), userId },
    { $set: { folderId, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (item && before?.folderId !== folderId) {
    await recordVaultItemEvent(userId, item._id, "item.folder_changed", {
      fromFolderId: before?.folderId ?? null,
      toFolderId: folderId,
    });
  }
  return item ? serialize(item) : null;
}

export async function setVaultItemFlag(
  userId: ObjectId,
  itemId: string,
  field: "favorite" | "archived" | "pinned" | "requiresRecent2FA",
  value: boolean,
) {
  if (!ObjectId.isValid(itemId)) return null;
  const item = await (await vaultItemsCollection()).findOneAndUpdate(
    { _id: new ObjectId(itemId), userId },
    { $set: { [field]: value, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (item) {
    const eventType = field === "favorite"
      ? "item.favorite_changed"
      : field === "archived"
        ? "item.archived_changed"
        : field === "pinned"
          ? "item.pinned_changed"
          : "item.recent_2fa_required_changed";
    await recordVaultItemEvent(userId, item._id, eventType, {
      [field]: value,
    });
  }
  return item ? serialize(item) : null;
}

export async function setVaultItemEncryptedTags(
  userId: ObjectId,
  itemId: string,
  input: z.infer<typeof encryptedTagsSchema>,
) {
  if (!ObjectId.isValid(itemId)) return null;
  const { tagCount, ...encrypted } = input;
  const item = await (await vaultItemsCollection()).findOneAndUpdate(
    { _id: new ObjectId(itemId), userId },
    { $set: { ...encrypted, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (item) await recordVaultItemEvent(userId, item._id, "item.tags_changed", { tagCount });
  return item ? serialize(item) : null;
}

export async function setVaultItemEncryptedNotes(
  userId: ObjectId,
  itemId: string,
  input: z.infer<typeof encryptedItemNotesSchema>,
) {
  if (!ObjectId.isValid(itemId)) return null;
  const item = await (await vaultItemsCollection()).findOneAndUpdate(
    { _id: new ObjectId(itemId), userId },
    { $set: { ...input, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (item) await recordVaultItemEvent(userId, item._id, "item.item_notes_updated");
  return item ? serialize(item) : null;
}

interface VaultItemEventDocument {
  userId: ObjectId;
  itemId: ObjectId;
  eventType: VaultItemEventType;
  metadata: VaultItemEvent["metadata"];
  createdAt: Date;
}

let eventIndexesReady: Promise<string> | undefined;

async function vaultItemEventsCollection(): Promise<Collection<VaultItemEventDocument>> {
  const collection = (await getDb()).collection<VaultItemEventDocument>("vaultItemEvents");
  eventIndexesReady ??= collection.createIndex({ userId: 1, itemId: 1, createdAt: -1 });
  await eventIndexesReady;
  return collection;
}

export async function listVaultItemEvents(userId: ObjectId, itemId: string) {
  if (!ObjectId.isValid(itemId)) return null;
  const id = new ObjectId(itemId);
  const item = await (await vaultItemsCollection()).findOne({ _id: id, userId }, { projection: { _id: 1 } });
  if (!item) return null;
  const events = await (await vaultItemEventsCollection())
    .find({ userId, itemId: id })
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray();
  return events.map((event) => ({
    id: event._id.toHexString(),
    eventType: event.eventType,
    metadata: event.metadata,
    createdAt: event.createdAt.toISOString(),
  }));
}

async function recordVaultItemEvent(
  userId: ObjectId,
  itemId: ObjectId,
  eventType: VaultItemEventType,
  metadata: VaultItemEvent["metadata"] = {},
) {
  await (await vaultItemEventsCollection()).insertOne({
    userId,
    itemId,
    eventType,
    metadata,
    createdAt: new Date(),
  });
}

async function recordVaultItemUpdateEvents(
  userId: ObjectId,
  itemId: ObjectId,
  before: VaultItemDocument,
  after: VaultItemDocument,
) {
  if (before.folderId !== after.folderId) {
    await recordVaultItemEvent(userId, itemId, "item.folder_changed", {
      fromFolderId: before.folderId ?? null,
      toFolderId: after.folderId ?? null,
    });
  }
  if (before.favorite !== after.favorite) {
    await recordVaultItemEvent(userId, itemId, "item.favorite_changed", { favorite: after.favorite });
  }
  if (before.pinned !== after.pinned) {
    await recordVaultItemEvent(userId, itemId, "item.pinned_changed", { pinned: after.pinned });
  }
  if (before.archived !== after.archived) {
    await recordVaultItemEvent(userId, itemId, "item.archived_changed", { archived: after.archived });
  }
  if (before.requiresRecent2FA !== after.requiresRecent2FA) {
    await recordVaultItemEvent(userId, itemId, "item.recent_2fa_required_changed", { requiresRecent2FA: after.requiresRecent2FA });
  }
  if (!before.hasExtraPassword && after.hasExtraPassword) {
    await recordVaultItemEvent(userId, itemId, "item.extra_password_enabled");
  }
  if (before.hasExtraPassword && !after.hasExtraPassword) {
    await recordVaultItemEvent(userId, itemId, "item.extra_password_disabled");
  }
  await recordVaultItemEvent(userId, itemId, "item.updated", {
    changedFields: ["encryptedTitle", "encryptedPayload", "encryptedSearchText"],
  });
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

async function migrateNoteItemsToDocuments(
  collection: Collection<VaultItemDocument>,
  userId: ObjectId,
) {
  // `type` is plaintext metadata; keep ciphertext and timestamps byte-for-byte unchanged.
  await collection.updateMany({ userId, type: "note" }, { $set: { type: "document" } });
}

import { type Collection, ObjectId, type WithId } from "mongodb";

import { getDb } from "~/lib/auth/db.server";
import { normalizeWorkspace, type WorkspaceState } from "~/lib/workspace";

interface WorkspaceDocument {
  userId: ObjectId;
  openNoteIds: ObjectId[];
  activeNoteId: ObjectId | null;
  openItemIds?: ObjectId[];
  activeItemId?: ObjectId | null;
  activeFolderId?: ObjectId | null;
  activeTypeFilter?: string | null;
  activeTagFilter?: null;
  sidebarExpandedFolders?: ObjectId[];
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  noteUiState: Record<
    string,
    { scrollTop: number; editorMode: "edit" | "preview" | "split" }
  >;
  createdAt: Date;
  updatedAt: Date;
}

let indexesReady: Promise<string> | undefined;

async function workspacesCollection(): Promise<Collection<WorkspaceDocument>> {
  const collection = (await getDb()).collection<WorkspaceDocument>("workspaces");
  indexesReady ??= collection.createIndex({ userId: 1 }, { unique: true });
  await indexesReady;
  return collection;
}

async function ownedItemIds(userId: ObjectId, itemIds: string[]) {
  const validIds = itemIds
    .filter((id) => ObjectId.isValid(id))
    .map((id) => new ObjectId(id));
  if (!validIds.length) return new Set<string>();
  const db = await getDb();
  const [notes, vaultItems] = await Promise.all([
    db
    .collection<{ userId: ObjectId }>("notes")
    .find({ userId, _id: { $in: validIds } }, { projection: { _id: 1 } })
    .toArray(),
    db
      .collection<{ userId: ObjectId }>("vaultItems")
      .find({ userId, _id: { $in: validIds } }, { projection: { _id: 1 } })
      .toArray(),
  ]);
  return new Set([...notes, ...vaultItems].map((item) => item._id.toHexString()));
}

async function ownedFolderIds(userId: ObjectId, folderIds: string[]) {
  const validIds = folderIds.filter(ObjectId.isValid).map((id) => new ObjectId(id));
  if (!validIds.length) return new Set<string>();
  const folders = await (await getDb()).collection<{ userId: ObjectId }>("folders")
    .find({ userId, _id: { $in: validIds } }, { projection: { _id: 1 } }).toArray();
  return new Set(folders.map((folder) => folder._id.toHexString()));
}

async function normalizeOwnedOrganization(userId: ObjectId, workspace: WorkspaceState) {
  const owned = await ownedFolderIds(userId, [
    ...(workspace.activeFolderId ? [workspace.activeFolderId] : []),
    ...workspace.sidebarExpandedFolders,
  ]);
  return {
    ...workspace,
    activeFolderId: workspace.activeFolderId && owned.has(workspace.activeFolderId) ? workspace.activeFolderId : null,
    sidebarExpandedFolders: workspace.sidebarExpandedFolders.filter((id) => owned.has(id)),
  };
}

function serializeWorkspace(document: WithId<WorkspaceDocument>): WorkspaceState {
  return {
    openNoteIds: document.openNoteIds.map((id) => id.toHexString()),
    activeNoteId: document.activeNoteId?.toHexString() ?? null,
    openItemIds: (document.openItemIds ?? document.openNoteIds).map((id) => id.toHexString()),
    activeItemId: (document.activeItemId ?? document.activeNoteId)?.toHexString() ?? null,
    activeFolderId: document.activeFolderId?.toHexString() ?? null,
    activeTypeFilter: document.activeTypeFilter ?? null,
    activeTagFilter: null,
    sidebarExpandedFolders: (document.sidebarExpandedFolders ?? []).map((id) => id.toHexString()),
    sidebarWidth: document.sidebarWidth,
    sidebarCollapsed: document.sidebarCollapsed,
    noteUiState: document.noteUiState,
    updatedAt: document.updatedAt.toISOString(),
  };
}

export async function getWorkspace(userId: ObjectId) {
  const collection = await workspacesCollection();
  const document = await collection.findOne({ userId });
  if (!document) return normalizeWorkspace(null, new Set());

  const serialized = serializeWorkspace(document);
  const normalized = await normalizeOwnedOrganization(userId, normalizeWorkspace(
    serialized,
    await ownedItemIds(userId, [...serialized.openNoteIds, ...serialized.openItemIds]),
  ));
  if (
    normalized.openNoteIds.length !== serialized.openNoteIds.length ||
    normalized.activeNoteId !== serialized.activeNoteId
    || normalized.openItemIds.length !== serialized.openItemIds.length
    || normalized.activeItemId !== serialized.activeItemId
  ) {
    return saveWorkspace(userId, normalized);
  }
  return normalized;
}

export async function saveWorkspace(
  userId: ObjectId,
  input: Partial<WorkspaceState>,
) {
  const normalized = await normalizeOwnedOrganization(userId, normalizeWorkspace(
    input,
    await ownedItemIds(userId, [...(input.openNoteIds ?? []), ...(input.openItemIds ?? [])]),
  ));
  const now = new Date();
  const document = await (await workspacesCollection()).findOneAndUpdate(
    { userId },
    {
      $set: {
        openNoteIds: normalized.openNoteIds.map((id) => new ObjectId(id)),
        activeNoteId: normalized.activeNoteId
          ? new ObjectId(normalized.activeNoteId)
          : null,
        openItemIds: normalized.openItemIds.map((id) => new ObjectId(id)),
        activeItemId: normalized.activeItemId ? new ObjectId(normalized.activeItemId) : null,
        activeFolderId: normalized.activeFolderId && ObjectId.isValid(normalized.activeFolderId) ? new ObjectId(normalized.activeFolderId) : null,
        activeTypeFilter: normalized.activeTypeFilter,
        activeTagFilter: null,
        sidebarExpandedFolders: normalized.sidebarExpandedFolders.filter(ObjectId.isValid).map((id) => new ObjectId(id)),
        sidebarWidth: normalized.sidebarWidth,
        sidebarCollapsed: normalized.sidebarCollapsed,
        noteUiState: normalized.noteUiState,
        updatedAt: now,
      },
      $setOnInsert: { userId, createdAt: now },
    },
    { upsert: true, returnDocument: "after" },
  );
  return serializeWorkspace(document!);
}

export async function removeNoteFromWorkspace(userId: ObjectId, noteId: string) {
  if (!ObjectId.isValid(noteId)) return;
  const collection = await workspacesCollection();
  await collection.updateOne(
    { userId },
    {
      $pull: { openNoteIds: new ObjectId(noteId), openItemIds: new ObjectId(noteId) },
      $unset: { [`noteUiState.${noteId}`]: "" },
      $set: { updatedAt: new Date() },
    },
  );
  await collection.updateOne(
    {
      userId,
      $or: [
        { activeNoteId: new ObjectId(noteId) },
        { activeItemId: new ObjectId(noteId) },
      ],
    },
    { $set: { activeNoteId: null, activeItemId: null, updatedAt: new Date() } },
  );
}

export async function removeItemFromWorkspace(userId: ObjectId, itemId: string) {
  if (!ObjectId.isValid(itemId)) return;
  const id = new ObjectId(itemId);
  const collection = await workspacesCollection();
  await collection.updateOne(
    { userId },
    { $pull: { openItemIds: id }, $set: { updatedAt: new Date() } },
  );
  await collection.updateOne(
    { userId, activeItemId: id },
    { $set: { activeItemId: null, updatedAt: new Date() } },
  );
}

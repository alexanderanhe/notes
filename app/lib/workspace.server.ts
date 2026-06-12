import { type Collection, ObjectId, type WithId } from "mongodb";

import { getDb } from "~/lib/auth/db.server";
import { normalizeWorkspace, type WorkspaceState } from "~/lib/workspace";

interface WorkspaceDocument {
  userId: ObjectId;
  openNoteIds: ObjectId[];
  activeNoteId: ObjectId | null;
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

async function ownedNoteIds(userId: ObjectId, noteIds: string[]) {
  const validIds = noteIds
    .filter((id) => ObjectId.isValid(id))
    .map((id) => new ObjectId(id));
  if (!validIds.length) return new Set<string>();
  const notes = await (await getDb())
    .collection<{ userId: ObjectId }>("notes")
    .find({ userId, _id: { $in: validIds } }, { projection: { _id: 1 } })
    .toArray();
  return new Set(notes.map((note) => note._id.toHexString()));
}

function serializeWorkspace(document: WithId<WorkspaceDocument>): WorkspaceState {
  return {
    openNoteIds: document.openNoteIds.map((id) => id.toHexString()),
    activeNoteId: document.activeNoteId?.toHexString() ?? null,
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
  const normalized = normalizeWorkspace(
    serialized,
    await ownedNoteIds(userId, serialized.openNoteIds),
  );
  if (
    normalized.openNoteIds.length !== serialized.openNoteIds.length ||
    normalized.activeNoteId !== serialized.activeNoteId
  ) {
    return saveWorkspace(userId, normalized);
  }
  return normalized;
}

export async function saveWorkspace(
  userId: ObjectId,
  input: Partial<WorkspaceState>,
) {
  const normalized = normalizeWorkspace(
    input,
    await ownedNoteIds(userId, input.openNoteIds ?? []),
  );
  const now = new Date();
  const document = await (await workspacesCollection()).findOneAndUpdate(
    { userId },
    {
      $set: {
        openNoteIds: normalized.openNoteIds.map((id) => new ObjectId(id)),
        activeNoteId: normalized.activeNoteId
          ? new ObjectId(normalized.activeNoteId)
          : null,
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
      $pull: { openNoteIds: new ObjectId(noteId) },
      $unset: { [`noteUiState.${noteId}`]: "" },
      $set: { updatedAt: new Date() },
    },
  );
  await collection.updateOne(
    { userId, activeNoteId: new ObjectId(noteId) },
    { $set: { activeNoteId: null, updatedAt: new Date() } },
  );
}

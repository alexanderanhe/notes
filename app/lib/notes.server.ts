import { type Collection, ObjectId, type WithId } from "mongodb";
import { z } from "zod";

import { getDb } from "~/lib/auth/db.server";
import {
  NOTE_ENCRYPTION_VERSION,
  type EncryptedNote,
  type EncryptedNoteInput,
  type EncryptedNoteSummary,
} from "~/lib/notes";

interface NoteDocument extends EncryptedNoteInput {
  userId: ObjectId;
  folderId?: string | null;
  isCritical?: boolean;
  criticalEnabledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  encryptedNoteKey?: string;
  noteKeyIv?: string;
  kdfSalt?: string;
}

let indexesReady: Promise<string> | undefined;

async function notesCollection(): Promise<Collection<NoteDocument>> {
  const collection = (await getDb()).collection<NoteDocument>("notes");
  indexesReady ??= collection.createIndex({ userId: 1, updatedAt: -1 });
  await indexesReady;
  return collection;
}

function isBase64(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(value)
  );
}

function isBase64Bytes(value: unknown, bytes: number): value is string {
  return isBase64(value, Math.ceil(bytes / 3) * 4) && atob(value).length === bytes;
}

const encryptedNoteSchema = z
  .object({
    encryptedTitle: z.string().refine((value) => isBase64(value, 64_000)),
    encryptedContent: z.string().refine((value) => isBase64(value, 8_000_000)),
    titleIv: z.string().refine((value) => isBase64Bytes(value, 12)),
    contentIv: z.string().refine((value) => isBase64Bytes(value, 12)),
    encryptionVersion: z.literal(NOTE_ENCRYPTION_VERSION),
    pinned: z.boolean(),
    archived: z.boolean(),
    hasExtraPassword: z.boolean(),
    extraPasswordSalt: z
      .string()
      .refine((value) => isBase64Bytes(value, 16))
      .optional(),
    extraPasswordEncryptedNoteKey: z
      .string()
      .refine((value) => isBase64Bytes(value, 60))
      .optional(),
    extraPasswordNoteKeyIv: z
      .string()
      .refine((value) => isBase64Bytes(value, 12))
      .optional(),
  })
  .strict()
  .superRefine((input, context) => {
    const fields = [
      input.extraPasswordSalt,
      input.extraPasswordEncryptedNoteKey,
      input.extraPasswordNoteKeyIv,
    ];
    if (
      (input.hasExtraPassword && fields.some((field) => !field)) ||
      (!input.hasExtraPassword && fields.some((field) => field !== undefined))
    ) {
      context.addIssue({
        code: "custom",
        message: "Invalid additional protection.",
      });
    }
  });

export function parseEncryptedNoteInput(value: unknown): EncryptedNoteInput {
  const parsed = encryptedNoteSchema.safeParse(value);
  if (!parsed.success) {
    throw new Response("Invalid encrypted payload.", { status: 400 });
  }
  return parsed.data;
}

function serializeSummary(note: WithId<NoteDocument>): EncryptedNoteSummary {
  return {
    id: note._id.toHexString(),
    folderId: note.folderId ?? null,
    encryptedTitle: note.encryptedTitle,
    titleIv: note.titleIv,
    encryptionVersion: note.encryptionVersion,
    pinned: note.pinned,
    archived: note.archived,
    hasExtraPassword: note.hasExtraPassword ?? false,
    isCritical: note.isCritical ?? false,
    ...(note.criticalEnabledAt
      ? { criticalEnabledAt: note.criticalEnabledAt.toISOString() }
      : {}),
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
    ...(note.encryptedNoteKey
      ? {
          encryptedNoteKey: note.encryptedNoteKey,
          noteKeyIv: note.noteKeyIv,
          kdfSalt: note.kdfSalt,
        }
      : {}),
  };
}

function serializeNote(note: WithId<NoteDocument>): EncryptedNote {
  return {
    ...serializeSummary(note),
    encryptedContent: note.encryptedContent,
    contentIv: note.contentIv,
    ...(note.hasExtraPassword
      ? {
          extraPasswordSalt: note.extraPasswordSalt,
          extraPasswordEncryptedNoteKey: note.extraPasswordEncryptedNoteKey,
          extraPasswordNoteKeyIv: note.extraPasswordNoteKeyIv,
        }
      : {}),
  };
}

export async function listEncryptedNotes(userId: ObjectId) {
  const notes = await (await notesCollection())
    .find({ userId })
    .sort({ pinned: -1, updatedAt: -1 })
    .toArray();
  return notes.map(serializeSummary);
}

export async function createEncryptedNote(
  userId: ObjectId,
  input: EncryptedNoteInput,
) {
  const now = new Date();
  const collection = await notesCollection();
  const result = await collection.insertOne({
    ...input,
    userId,
    isCritical: false,
    createdAt: now,
    updatedAt: now,
  });
  const note = await collection.findOne({ _id: result.insertedId, userId });

  if (!note) {
    throw new Response("The note could not be created.", { status: 500 });
  }

  return serializeNote(note);
}

export async function getEncryptedNote(userId: ObjectId, noteId: string) {
  if (!ObjectId.isValid(noteId)) {
    return null;
  }

  const note = await (await notesCollection()).findOne({
    _id: new ObjectId(noteId),
    userId,
  });
  return note ? serializeNote(note) : null;
}

export async function getEncryptedNoteSummary(userId: ObjectId, noteId: string) {
  if (!ObjectId.isValid(noteId)) return null;
  const note = await (await notesCollection()).findOne(
    { _id: new ObjectId(noteId), userId },
    { projection: { encryptedContent: 0, contentIv: 0 } },
  );
  return note ? serializeSummary(note) : null;
}

export async function updateEncryptedNote(
  userId: ObjectId,
  noteId: string,
  input: EncryptedNoteInput,
) {
  if (!ObjectId.isValid(noteId)) {
    return null;
  }

  const collection = await notesCollection();
  const note = await collection.findOneAndUpdate(
    { _id: new ObjectId(noteId), userId },
    {
      $set: { ...input, updatedAt: new Date() },
      $unset: {
        encryptedNoteKey: "",
        noteKeyIv: "",
        kdfSalt: "",
        ...(input.hasExtraPassword
          ? {}
          : {
              extraPasswordSalt: "",
              extraPasswordEncryptedNoteKey: "",
              extraPasswordNoteKeyIv: "",
            }),
      },
    },
    { returnDocument: "after" },
  );
  return note ? serializeNote(note) : null;
}

export async function deleteEncryptedNote(userId: ObjectId, noteId: string) {
  if (!ObjectId.isValid(noteId)) {
    return false;
  }

  const result = await (await notesCollection()).deleteOne({
    _id: new ObjectId(noteId),
    userId,
  });
  return result.deletedCount === 1;
}

export async function setNoteCritical(
  userId: ObjectId,
  noteId: string,
  isCritical: boolean,
) {
  if (!ObjectId.isValid(noteId)) return null;
  const collection = await notesCollection();
  const note = await collection.findOneAndUpdate(
    { _id: new ObjectId(noteId), userId },
    isCritical
      ? {
          $set: {
            isCritical: true,
            criticalEnabledAt: new Date(),
            updatedAt: new Date(),
          },
        }
      : {
          $set: { isCritical: false, updatedAt: new Date() },
          $unset: { criticalEnabledAt: "" },
        },
    { returnDocument: "after" },
  );
  return note ? serializeSummary(note) : null;
}

export async function hasCriticalNotes(userId: ObjectId) {
  return (await notesCollection()).countDocuments(
    { userId, isCritical: true },
    { limit: 1 },
  ).then((count) => count > 0);
}

export async function setNoteFolder(
  userId: ObjectId,
  noteId: string,
  folderId: string | null,
) {
  if (!ObjectId.isValid(noteId)) return null;
  if (folderId !== null) {
    if (!ObjectId.isValid(folderId)) throw new Response("Invalid folder.", { status: 400 });
    const folder = await (await getDb()).collection<{ userId: ObjectId }>("folders").findOne({
      _id: new ObjectId(folderId),
      userId,
    });
    if (!folder) throw new Response("Folder not found.", { status: 404 });
  }
  const note = await (await notesCollection()).findOneAndUpdate(
    { _id: new ObjectId(noteId), userId },
    { $set: { folderId, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  return note ? serializeSummary(note) : null;
}

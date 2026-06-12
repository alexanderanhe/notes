import {
  decryptNoteKey,
  decryptString,
  deriveKeyFromPassword,
  encryptNoteKey,
  encryptString,
  generateNoteKey,
} from "~/lib/crypto.client";
import {
  LEGACY_NOTE_ENCRYPTION_VERSION,
  NOTE_ENCRYPTION_VERSION,
  type EncryptedNote,
  type EncryptedNoteInput,
  type EncryptedNoteSummary,
} from "~/lib/notes";

export interface PlainNote {
  title: string;
  content: string;
}

type NoteMetadata = Pick<EncryptedNoteInput, "pinned" | "archived">;
type ExtraPasswordFields = Required<
  Pick<
    EncryptedNoteInput,
    | "extraPasswordSalt"
    | "extraPasswordEncryptedNoteKey"
    | "extraPasswordNoteKeyIv"
  >
>;

function requireLegacyKeyFields(note: EncryptedNoteSummary) {
  if (!note.encryptedNoteKey || !note.noteKeyIv || !note.kdfSalt) {
    throw new Error("La nota legacy no contiene material de migración.");
  }
  return {
    encryptedNoteKey: note.encryptedNoteKey,
    noteKeyIv: note.noteKeyIv,
    kdfSalt: note.kdfSalt,
  };
}

async function getContentKey(note: EncryptedNoteSummary, masterKey: CryptoKey) {
  if (note.hasExtraPassword) {
    throw new Error("La nota requiere su contraseña adicional.");
  }

  if (note.encryptionVersion !== LEGACY_NOTE_ENCRYPTION_VERSION) {
    return masterKey;
  }

  throw new Error("La nota debe migrarse antes de descifrarla.");
}

function requireExtraPasswordFields(note: EncryptedNote): ExtraPasswordFields {
  if (
    !note.hasExtraPassword ||
    !note.extraPasswordSalt ||
    !note.extraPasswordEncryptedNoteKey ||
    !note.extraPasswordNoteKeyIv
  ) {
    throw new Error("La nota protegida no contiene un sobre de clave válido.");
  }

  return {
    extraPasswordSalt: note.extraPasswordSalt,
    extraPasswordEncryptedNoteKey: note.extraPasswordEncryptedNoteKey,
    extraPasswordNoteKeyIv: note.extraPasswordNoteKeyIv,
  };
}

async function wrapNoteKey(noteKey: CryptoKey, password: string) {
  const { key, salt } = await deriveKeyFromPassword(password);
  const encrypted = await encryptNoteKey(noteKey, key);
  return {
    extraPasswordSalt: salt,
    extraPasswordEncryptedNoteKey: encrypted.ciphertext,
    extraPasswordNoteKeyIv: encrypted.iv,
  };
}

export async function unlockProtectedNoteKey(
  note: EncryptedNote,
  password: string,
) {
  const fields = requireExtraPasswordFields(note);
  const { key } = await deriveKeyFromPassword(
    password,
    fields.extraPasswordSalt,
  );
  return decryptNoteKey(
    {
      ciphertext: fields.extraPasswordEncryptedNoteKey,
      iv: fields.extraPasswordNoteKeyIv,
    },
    key,
  );
}

export async function decryptLegacyNote(
  note: EncryptedNote,
  password: string,
) {
  const legacy = requireLegacyKeyFields(note);
  const { key: legacyUserKey } = await deriveKeyFromPassword(
    password,
    legacy.kdfSalt,
  );
  const noteKey = await decryptNoteKey(
    { ciphertext: legacy.encryptedNoteKey, iv: legacy.noteKeyIv },
    legacyUserKey,
  );
  const [title, content] = await Promise.all([
    decryptString({ ciphertext: note.encryptedTitle, iv: note.titleIv }, noteKey),
    decryptString(
      { ciphertext: note.encryptedContent, iv: note.contentIv },
      noteKey,
    ),
  ]);
  return { title, content };
}

export async function decryptNoteTitle(
  note: EncryptedNoteSummary,
  masterKey: CryptoKey,
) {
  const contentKey = await getContentKey(note, masterKey);
  return decryptString(
    { ciphertext: note.encryptedTitle, iv: note.titleIv },
    contentKey,
  );
}

export async function decryptNote(
  note: EncryptedNote,
  masterKey: CryptoKey,
  unlockedNoteKey?: CryptoKey,
) {
  const contentKey = note.hasExtraPassword
    ? unlockedNoteKey
    : await getContentKey(note, masterKey);
  if (!contentKey) {
    throw new Error("La nota requiere su contraseña adicional.");
  }
  const [title, content] = await Promise.all([
    decryptString(
      { ciphertext: note.encryptedTitle, iv: note.titleIv },
      contentKey,
    ),
    decryptString(
      { ciphertext: note.encryptedContent, iv: note.contentIv },
      contentKey,
    ),
  ]);
  return { title, content };
}

export async function encryptNote(
  note: PlainNote,
  contentKey: CryptoKey,
  metadata: NoteMetadata,
  extraPasswordFields?: ExtraPasswordFields,
): Promise<EncryptedNoteInput> {
  const [title, content] = await Promise.all([
    encryptString(note.title, contentKey),
    encryptString(note.content, contentKey),
  ]);
  return {
    encryptedTitle: title.ciphertext,
    encryptedContent: content.ciphertext,
    titleIv: title.iv,
    contentIv: content.iv,
    encryptionVersion: NOTE_ENCRYPTION_VERSION,
    pinned: metadata.pinned,
    archived: metadata.archived,
    hasExtraPassword: Boolean(extraPasswordFields),
    ...extraPasswordFields,
  };
}

export async function protectNote(
  note: PlainNote,
  password: string,
  metadata: NoteMetadata,
) {
  const noteKey = await generateNoteKey();
  const extraPasswordFields = await wrapNoteKey(noteKey, password);
  return {
    input: await encryptNote(note, noteKey, metadata, extraPasswordFields),
    noteKey,
  };
}

export async function changeNoteExtraPassword(
  note: EncryptedNote,
  currentPassword: string,
  newPassword: string,
): Promise<{ input: EncryptedNoteInput; noteKey: CryptoKey }> {
  const noteKey = await unlockProtectedNoteKey(note, currentPassword);
  const extraPasswordFields = await wrapNoteKey(noteKey, newPassword);
  return {
    noteKey,
    input: {
      encryptedTitle: note.encryptedTitle,
      encryptedContent: note.encryptedContent,
      titleIv: note.titleIv,
      contentIv: note.contentIv,
      encryptionVersion: NOTE_ENCRYPTION_VERSION,
      pinned: note.pinned,
      archived: note.archived,
      hasExtraPassword: true,
      ...extraPasswordFields,
    },
  };
}

export async function removeNoteExtraPassword(
  note: EncryptedNote,
  password: string,
  masterKey: CryptoKey,
) {
  const noteKey = await unlockProtectedNoteKey(note, password);
  const plain = await decryptNote(note, masterKey, noteKey);
  return encryptNote(plain, masterKey, {
    pinned: note.pinned,
    archived: note.archived,
  });
}

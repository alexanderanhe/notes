export const NOTE_ENCRYPTION_VERSION = 2;
export const LEGACY_NOTE_ENCRYPTION_VERSION = 1;

export interface EncryptedNoteSummary {
  id: string;
  encryptedTitle: string;
  titleIv: string;
  encryptionVersion: number;
  pinned: boolean;
  archived: boolean;
  hasExtraPassword: boolean;
  isCritical: boolean;
  criticalEnabledAt?: string;
  createdAt: string;
  updatedAt: string;
  encryptedNoteKey?: string;
  noteKeyIv?: string;
  kdfSalt?: string;
}

export interface EncryptedNote extends EncryptedNoteSummary {
  encryptedContent: string;
  contentIv: string;
  extraPasswordSalt?: string;
  extraPasswordEncryptedNoteKey?: string;
  extraPasswordNoteKeyIv?: string;
}

export interface EncryptedNoteInput {
  encryptedTitle: string;
  encryptedContent: string;
  titleIv: string;
  contentIv: string;
  encryptionVersion: number;
  pinned: boolean;
  archived: boolean;
  hasExtraPassword: boolean;
  extraPasswordSalt?: string;
  extraPasswordEncryptedNoteKey?: string;
  extraPasswordNoteKeyIv?: string;
}

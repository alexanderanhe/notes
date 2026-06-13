export const MAX_FOLDERS = 100;
export const MAX_FOLDER_DEPTH = 5;
export const MAX_FOLDER_NAME_LENGTH = 80;
export const MAX_TAG_LENGTH = 40;
export const MAX_TAGS_PER_ITEM = 20;

export interface EncryptedFolderInput {
  parentFolderId: string | null;
  encryptedName: string;
  nameIv: string;
  encryptedIcon: string;
  iconIv: string;
  encryptedColor: string;
  colorIv: string;
  sortOrder: number;
}

export interface EncryptedFolder extends EncryptedFolderInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface Folder {
  id: string;
  parentFolderId: string | null;
  name: string;
  icon: string;
  color: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export type FolderDeleteStrategy = "move-to-parent" | "uncategorized" | "archive-items";

export function normalizeFolderName(value: string) {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name || name.length > MAX_FOLDER_NAME_LENGTH) {
    throw new Error(`Folder names must be between 1 and ${MAX_FOLDER_NAME_LENGTH} characters.`);
  }
  return name;
}

export function normalizeTags(values: string[]) {
  const tags = Array.from(new Set(values.map((value) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase()).filter(Boolean)));
  if (tags.length > MAX_TAGS_PER_ITEM || tags.some((tag) => tag.length > MAX_TAG_LENGTH)) {
    throw new Error(`Use at most ${MAX_TAGS_PER_ITEM} tags of ${MAX_TAG_LENGTH} characters or fewer.`);
  }
  return tags;
}


import { decryptString, encryptString } from "~/lib/crypto.client";
import { normalizeFolderName, type EncryptedFolder, type EncryptedFolderInput, type Folder, type FolderDeleteStrategy } from "~/lib/folders";

export async function encryptFolder(
  name: string,
  masterKey: CryptoKey,
  options: { parentFolderId?: string | null; icon?: string; color?: string; sortOrder?: number } = {},
): Promise<EncryptedFolderInput> {
  const normalized = normalizeFolderName(name);
  const [encryptedName, encryptedIcon, encryptedColor] = await Promise.all([
    encryptString(normalized, masterKey),
    encryptString(options.icon ?? "folder", masterKey),
    encryptString(options.color ?? "zinc", masterKey),
  ]);
  return {
    parentFolderId: options.parentFolderId ?? null,
    encryptedName: encryptedName.ciphertext,
    nameIv: encryptedName.iv,
    encryptedIcon: encryptedIcon.ciphertext,
    iconIv: encryptedIcon.iv,
    encryptedColor: encryptedColor.ciphertext,
    colorIv: encryptedColor.iv,
    sortOrder: options.sortOrder ?? 0,
  };
}

export async function decryptFolder(folder: EncryptedFolder, masterKey: CryptoKey): Promise<Folder> {
  const [name, icon, color] = await Promise.all([
    decryptString({ ciphertext: folder.encryptedName, iv: folder.nameIv }, masterKey),
    decryptString({ ciphertext: folder.encryptedIcon, iv: folder.iconIv }, masterKey),
    decryptString({ ciphertext: folder.encryptedColor, iv: folder.colorIv }, masterKey),
  ]);
  return { ...folder, name, icon, color };
}

export async function createFolder(name: string, parentFolderId: string | null, masterKey: CryptoKey) {
  return requestJson<{ folder: EncryptedFolder }>("/api/folders", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(await encryptFolder(name, masterKey, { parentFolderId })),
  });
}

export async function renameFolder(folder: Folder, name: string, masterKey: CryptoKey) {
  return requestJson<{ folder: EncryptedFolder }>(`/api/folders/${folder.id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(await encryptFolder(name, masterKey, folder)),
  });
}

export async function moveFolder(folderId: string, parentFolderId: string | null) {
  return requestJson<{ folder: EncryptedFolder }>(`/api/folders/${folderId}/move`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parentFolderId }),
  });
}

export async function deleteFolder(folderId: string, strategy: FolderDeleteStrategy) {
  return requestJson<{ deleted: true }>(`/api/folders/${folderId}`, {
    method: "DELETE", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ strategy }),
  });
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}


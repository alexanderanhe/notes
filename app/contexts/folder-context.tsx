import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { useVault } from "~/contexts/vault-context";
import { createFolder as createEncrypted, decryptFolder, deleteFolder as deleteEncrypted, moveFolder as moveEncrypted, renameFolder as renameEncrypted } from "~/lib/folders.client";
import type { EncryptedFolder, Folder, FolderDeleteStrategy } from "~/lib/folders";

interface FolderContextValue {
  folders: Folder[];
  loading: boolean;
  refreshFolders: () => Promise<void>;
  createFolder: (name: string, parentFolderId: string | null) => Promise<void>;
  renameFolder: (folder: Folder, name: string) => Promise<void>;
  moveFolder: (folderId: string, parentFolderId: string | null) => Promise<void>;
  deleteFolder: (folderId: string, strategy: FolderDeleteStrategy) => Promise<void>;
}

const FolderContext = createContext<FolderContextValue | null>(null);

export function FolderProvider({ children }: { children: ReactNode }) {
  const { masterKey } = useVault();
  const [encryptedFolders, setEncryptedFolders] = useState<EncryptedFolder[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshFolders = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/folders");
      if (!response.ok) throw new Error();
      const result = await response.json() as { folders: EncryptedFolder[] };
      setEncryptedFolders(result.folders);
    } catch {
      toast.error("Folders could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refreshFolders(); }, [refreshFolders]);
  useEffect(() => {
    if (!masterKey) return;
    Promise.all(encryptedFolders.map((folder) => decryptFolder(folder, masterKey)))
      .then(setFolders)
      .catch(() => toast.error("Folder names could not be decrypted."));
  }, [encryptedFolders, masterKey]);

  const replace = (folder: EncryptedFolder) =>
    setEncryptedFolders((current) => [folder, ...current.filter((item) => item.id !== folder.id)]);

  async function createFolder(name: string, parentFolderId: string | null) {
    if (!masterKey) return;
    replace((await createEncrypted(name, parentFolderId, masterKey)).folder);
  }

  async function renameFolder(folder: Folder, name: string) {
    if (!masterKey) return;
    replace((await renameEncrypted(folder, name, masterKey)).folder);
  }

  async function moveFolder(folderId: string, parentFolderId: string | null) {
    replace((await moveEncrypted(folderId, parentFolderId)).folder);
  }

  async function deleteFolder(folderId: string, strategy: FolderDeleteStrategy) {
    await deleteEncrypted(folderId, strategy);
    setEncryptedFolders((current) => current.filter((folder) => folder.id !== folderId));
    setFolders((current) => current.filter((folder) => folder.id !== folderId));
  }

  return <FolderContext.Provider value={{ folders, loading, refreshFolders, createFolder, renameFolder, moveFolder, deleteFolder }}>{children}</FolderContext.Provider>;
}

export function useFolders() {
  const context = useContext(FolderContext);
  if (!context) throw new Error("useFolders must be used within FolderProvider.");
  return context;
}


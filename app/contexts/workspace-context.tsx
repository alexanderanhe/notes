import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  emptyWorkspace,
  MAX_OPEN_NOTES,
  type WorkspaceNoteUiState,
  type WorkspaceState,
} from "~/lib/workspace";

interface WorkspaceContextValue extends WorkspaceState {
  loading: boolean;
  openNote: (noteId: string) => void;
  closeNote: (noteId: string) => void;
  setActiveNote: (noteId: string | null) => void;
  openItem: (itemId: string) => void;
  closeItem: (itemId: string) => void;
  setActiveItem: (itemId: string | null) => void;
  setOrganizationState: (state: Partial<Pick<WorkspaceState, "activeFolderId" | "activeTypeFilter" | "sidebarExpandedFolders">>) => void;
  setSidebarWidth: (width: number) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  updateNoteUiState: (
    noteId: string,
    partial: Partial<WorkspaceNoteUiState>,
  ) => void;
  restoreWorkspace: () => Promise<void>;
  persistWorkspaceDebounced: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspace] = useState<WorkspaceState>(emptyWorkspace);
  const [loading, setLoading] = useState(true);
  const workspaceRef = useRef(workspace);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateWorkspace = useCallback(
    (update: (current: WorkspaceState) => WorkspaceState) => {
      setWorkspace((current) => {
        const next = update(current);
        workspaceRef.current = next;
        return next;
      });
    },
    [],
  );

  const persistWorkspace = useCallback(async (keepalive = false) => {
    const snapshot = workspaceRef.current;
    try {
      const response = await fetch("/api/workspace", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        keepalive,
        body: JSON.stringify({
          openNoteIds: snapshot.openNoteIds,
          activeNoteId: snapshot.activeNoteId,
          openItemIds: snapshot.openItemIds,
          activeItemId: snapshot.activeItemId,
          activeFolderId: snapshot.activeFolderId,
          activeTypeFilter: snapshot.activeTypeFilter,
          activeTagFilter: null,
          sidebarExpandedFolders: snapshot.sidebarExpandedFolders,
          sidebarWidth: snapshot.sidebarWidth,
          sidebarCollapsed: snapshot.sidebarCollapsed,
          noteUiState: snapshot.noteUiState,
        }),
      });
      if (!response.ok) return;
      const result = (await response.json()) as { workspace: WorkspaceState };
      updateWorkspace((current) => ({
        ...current,
        updatedAt: result.workspace.updatedAt,
      }));
    } catch {
      // Workspace persistence is background-only and must not interrupt editing.
    }
  }, [updateWorkspace]);

  const persistWorkspaceDebounced = useCallback(() => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => void persistWorkspace(), 750);
  }, [persistWorkspace]);

  const restoreWorkspace = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/workspace");
      if (!response.ok) return;
      const result = (await response.json()) as { workspace: WorkspaceState };
      workspaceRef.current = result.workspace;
      setWorkspace(result.workspace);
    } catch {
      // The editor remains usable with an empty local workspace.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void restoreWorkspace();
    const flush = () => void persistWorkspace(true);
    window.addEventListener("pagehide", flush);
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
      window.removeEventListener("pagehide", flush);
    };
  }, [persistWorkspace, restoreWorkspace]);

  const openNote = useCallback(
    (noteId: string) => {
      updateWorkspace((current) => {
        const openNoteIds = current.openNoteIds.includes(noteId)
          ? current.openNoteIds
          : [...current.openNoteIds, noteId].slice(-MAX_OPEN_NOTES);
        return { ...current, openNoteIds, activeNoteId: noteId };
      });
      persistWorkspaceDebounced();
    },
    [persistWorkspaceDebounced, updateWorkspace],
  );

  const closeNote = useCallback(
    (noteId: string) => {
      updateWorkspace((current) => {
        const openNoteIds = current.openNoteIds.filter((id) => id !== noteId);
        const noteUiState = { ...current.noteUiState };
        delete noteUiState[noteId];
        return {
          ...current,
          openNoteIds,
          activeNoteId:
            current.activeNoteId === noteId
              ? openNoteIds[0] ?? null
              : current.activeNoteId,
          noteUiState,
        };
      });
      persistWorkspaceDebounced();
    },
    [persistWorkspaceDebounced, updateWorkspace],
  );

  const setActiveNote = useCallback(
    (noteId: string | null) => {
      updateWorkspace((current) => ({ ...current, activeNoteId: noteId }));
      persistWorkspaceDebounced();
    },
    [persistWorkspaceDebounced, updateWorkspace],
  );

  const openItem = useCallback(
    (itemId: string) => {
      updateWorkspace((current) => ({
        ...current,
        openItemIds: current.openItemIds.includes(itemId)
          ? current.openItemIds
          : [...current.openItemIds, itemId].slice(-MAX_OPEN_NOTES),
        activeItemId: itemId,
      }));
      persistWorkspaceDebounced();
    },
    [persistWorkspaceDebounced, updateWorkspace],
  );

  const closeItem = useCallback(
    (itemId: string) => {
      updateWorkspace((current) => {
        const openItemIds = current.openItemIds.filter((id) => id !== itemId);
        return {
          ...current,
          openItemIds,
          activeItemId: current.activeItemId === itemId ? openItemIds[0] ?? null : current.activeItemId,
        };
      });
      persistWorkspaceDebounced();
    },
    [persistWorkspaceDebounced, updateWorkspace],
  );

  const setActiveItem = useCallback(
    (activeItemId: string | null) => {
      updateWorkspace((current) => ({ ...current, activeItemId }));
      persistWorkspaceDebounced();
    },
    [persistWorkspaceDebounced, updateWorkspace],
  );

  const setOrganizationState = useCallback(
    (state: Partial<Pick<WorkspaceState, "activeFolderId" | "activeTypeFilter" | "sidebarExpandedFolders">>) => {
      updateWorkspace((current) => ({ ...current, ...state }));
      persistWorkspaceDebounced();
    },
    [persistWorkspaceDebounced, updateWorkspace],
  );

  const setSidebarWidth = useCallback(
    (sidebarWidth: number) => {
      updateWorkspace((current) => ({ ...current, sidebarWidth }));
      persistWorkspaceDebounced();
    },
    [persistWorkspaceDebounced, updateWorkspace],
  );

  const setSidebarCollapsed = useCallback(
    (sidebarCollapsed: boolean) => {
      updateWorkspace((current) => ({ ...current, sidebarCollapsed }));
      persistWorkspaceDebounced();
    },
    [persistWorkspaceDebounced, updateWorkspace],
  );

  const updateNoteUiState = useCallback(
    (noteId: string, partial: Partial<WorkspaceNoteUiState>) => {
      updateWorkspace((current) => {
        const previous = current.noteUiState[noteId];
        return {
          ...current,
          noteUiState: {
            ...current.noteUiState,
            [noteId]: {
              scrollTop: partial.scrollTop ?? previous?.scrollTop ?? 0,
              editorMode:
                partial.editorMode ?? previous?.editorMode ?? "preview",
            },
          },
        };
      });
      persistWorkspaceDebounced();
    },
    [persistWorkspaceDebounced, updateWorkspace],
  );

  return (
    <WorkspaceContext.Provider
      value={{
        ...workspace,
        loading,
        openNote,
        closeNote,
        setActiveNote,
        openItem,
        closeItem,
        setActiveItem,
        setOrganizationState,
        setSidebarWidth,
        setSidebarCollapsed,
        updateNoteUiState,
        restoreWorkspace,
        persistWorkspaceDebounced,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace must be used within WorkspaceProvider.");
  return context;
}

export const MAX_OPEN_NOTES = 10;
export const MIN_SIDEBAR_WIDTH = 240;
export const MAX_SIDEBAR_WIDTH = 440;
export const DEFAULT_SIDEBAR_WIDTH = 288;

export type WorkspaceEditorMode = "edit" | "preview" | "split";

export interface WorkspaceNoteUiState {
  scrollTop: number;
  editorMode: WorkspaceEditorMode;
}

export interface WorkspaceState {
  openNoteIds: string[];
  activeNoteId: string | null;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  noteUiState: Record<string, WorkspaceNoteUiState>;
  updatedAt: string | null;
}

export const emptyWorkspace: WorkspaceState = {
  openNoteIds: [],
  activeNoteId: null,
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  sidebarCollapsed: false,
  noteUiState: {},
  updatedAt: null,
};

export function normalizeWorkspace(
  input: Partial<WorkspaceState> | null | undefined,
  ownedNoteIds: ReadonlySet<string>,
): WorkspaceState {
  const openNoteIds = Array.from(
    new Set((input?.openNoteIds ?? []).filter((id) => ownedNoteIds.has(id))),
  ).slice(0, MAX_OPEN_NOTES);
  const activeNoteId =
    input?.activeNoteId && openNoteIds.includes(input.activeNoteId)
      ? input.activeNoteId
      : openNoteIds[0] ?? null;
  const noteUiState = Object.fromEntries(
    openNoteIds.map((id) => {
      const state = input?.noteUiState?.[id];
      return [
        id,
        {
          scrollTop: clampNumber(state?.scrollTop, 0, 10_000_000, 0),
          editorMode: isEditorMode(state?.editorMode)
            ? state.editorMode
            : "preview",
        },
      ];
    }),
  );

  return {
    openNoteIds,
    activeNoteId,
    sidebarWidth: clampNumber(
      input?.sidebarWidth,
      MIN_SIDEBAR_WIDTH,
      MAX_SIDEBAR_WIDTH,
      DEFAULT_SIDEBAR_WIDTH,
    ),
    sidebarCollapsed: input?.sidebarCollapsed === true,
    noteUiState,
    updatedAt: typeof input?.updatedAt === "string" ? input.updatedAt : null,
  };
}

function isEditorMode(value: unknown): value is WorkspaceEditorMode {
  return value === "edit" || value === "preview" || value === "split";
}

function clampNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.round(Math.min(maximum, Math.max(minimum, value)));
}

import { describe, expect, it } from "vitest";

import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_OPEN_NOTES,
  normalizeWorkspace,
} from "./workspace";

describe("workspace normalization", () => {
  it("restores an empty workspace", () => {
    expect(normalizeWorkspace(null, new Set())).toMatchObject({
      openNoteIds: [],
      activeNoteId: null,
      sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      sidebarCollapsed: false,
      noteUiState: {},
    });
  });

  it("restores valid notes and their UI state", () => {
    const workspace = normalizeWorkspace(
      {
        openNoteIds: ["a", "b"],
        activeNoteId: "b",
        sidebarWidth: 320,
        sidebarCollapsed: true,
        noteUiState: {
          b: { scrollTop: 450, editorMode: "edit" },
        },
      },
      new Set(["a", "b"]),
    );
    expect(workspace).toMatchObject({
      openNoteIds: ["a", "b"],
      activeNoteId: "b",
      sidebarWidth: 320,
      sidebarCollapsed: true,
      noteUiState: {
        a: { scrollTop: 0, editorMode: "preview" },
        b: { scrollTop: 450, editorMode: "edit" },
      },
    });
  });

  it("removes missing notes and selects the first valid active note", () => {
    const workspace = normalizeWorkspace(
      { openNoteIds: ["missing", "valid"], activeNoteId: "missing" },
      new Set(["valid"]),
    );
    expect(workspace.openNoteIds).toEqual(["valid"]);
    expect(workspace.activeNoteId).toBe("valid");
  });

  it("limits open notes to ten", () => {
    const ids = Array.from({ length: 15 }, (_, index) => `note-${index}`);
    expect(normalizeWorkspace({ openNoteIds: ids }, new Set(ids)).openNoteIds)
      .toHaveLength(MAX_OPEN_NOTES);
  });

  it("does not restore another user's notes", () => {
    const workspace = normalizeWorkspace(
      { openNoteIds: ["owned", "other-user"], activeNoteId: "other-user" },
      new Set(["owned"]),
    );
    expect(workspace.openNoteIds).toEqual(["owned"]);
    expect(workspace.activeNoteId).toBe("owned");
  });

  it("keeps a valid active note", () => {
    const workspace = normalizeWorkspace(
      { openNoteIds: ["a", "b"], activeNoteId: "b" },
      new Set(["a", "b"]),
    );
    expect(workspace.activeNoteId).toBe("b");
  });

  it("restores vault items while keeping legacy note workspace fields", () => {
    const workspace = normalizeWorkspace(
      {
        openNoteIds: ["legacy-note"],
        activeNoteId: "legacy-note",
        openItemIds: ["vault-item"],
        activeItemId: "vault-item",
      },
      new Set(["legacy-note", "vault-item"]),
    );
    expect(workspace.openNoteIds).toEqual(["legacy-note"]);
    expect(workspace.openItemIds).toEqual(["vault-item"]);
    expect(workspace.activeItemId).toBe("vault-item");
  });
});

import { describe, expect, it } from "vitest";

import { generateNoteKey } from "./crypto.client";
import { decryptFolder, encryptFolder } from "./folders.client";
import { normalizeFolderName, normalizeTags } from "./folders";
import { parseEncryptedFolderInput } from "./folders.server";

describe("encrypted folders and tags", () => {
  it("encrypts folder names before persistence", async () => {
    const key = await generateNoteKey();
    const encrypted = await encryptFolder("Private Work", key, { parentFolderId: null });
    expect(JSON.stringify(encrypted)).not.toContain("Private Work");
    const decrypted = await decryptFolder({
      ...encrypted,
      id: "folder",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }, key);
    expect(decrypted.name).toBe("Private Work");
  });

  it("accepts ciphertext but rejects plaintext folder fields", async () => {
    const key = await generateNoteKey();
    const encrypted = await encryptFolder("Work", key);
    expect(parseEncryptedFolderInput(encrypted)).toEqual(encrypted);
    expect(() => parseEncryptedFolderInput({ ...encrypted, name: "Work" })).toThrow();
  });

  it("normalizes names and tags and rejects unsafe limits", () => {
    expect(normalizeFolderName("  Work   Servers ")).toBe("Work Servers");
    expect(normalizeTags([" Production ", "production", " client "])).toEqual(["production", "client"]);
    expect(() => normalizeFolderName("x".repeat(81))).toThrow();
    expect(() => normalizeTags(Array.from({ length: 21 }, (_, index) => `tag-${index}`))).toThrow();
  });
});


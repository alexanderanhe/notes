import { describe, expect, it } from "vitest";

import { parseEncryptedItemNotesInput, parseEncryptedTagsInput, parseEncryptedVaultItemInput } from "./vault-items.server";

const validInput = {
  type: "password",
  folderId: null,
  encryptedTitle: Buffer.alloc(16).toString("base64"),
  titleIv: Buffer.alloc(12).toString("base64"),
  encryptedPayload: Buffer.alloc(64).toString("base64"),
  payloadIv: Buffer.alloc(12).toString("base64"),
  encryptedSearchText: Buffer.alloc(64).toString("base64"),
  searchTextIv: Buffer.alloc(12).toString("base64"),
  tagsEncrypted: Buffer.alloc(16).toString("base64"),
  tagsIv: Buffer.alloc(12).toString("base64"),
  favorite: false,
  archived: false,
  pinned: false,
  requiresRecent2FA: false,
  hasExtraPassword: false,
  encryptionVersion: 1,
} as const;

describe("encrypted vault item input", () => {
  it("accepts ciphertext and safe metadata", () => {
    expect(parseEncryptedVaultItemInput(validInput)).toEqual(validInput);
  });

  it("accepts both document items and legacy note items", () => {
    expect(parseEncryptedVaultItemInput({ ...validInput, type: "document" }).type).toBe("document");
    expect(parseEncryptedVaultItemInput({ ...validInput, type: "note" }).type).toBe("note");
  });

  it("rejects plaintext or unknown metadata", () => {
    expect(() => parseEncryptedVaultItemInput({
      ...validInput,
      username: "plaintext-user",
    })).toThrow();
  });

  it("requires complete extra password metadata", () => {
    expect(() => parseEncryptedVaultItemInput({
      ...validInput,
      hasExtraPassword: true,
      extraPasswordSalt: Buffer.alloc(16).toString("base64"),
    })).toThrow();
    expect(parseEncryptedVaultItemInput({
      ...validInput,
      hasExtraPassword: true,
      extraPasswordSalt: Buffer.alloc(16).toString("base64"),
      extraPasswordEncryptedItemKey: Buffer.alloc(48).toString("base64"),
      extraPasswordItemKeyIv: Buffer.alloc(12).toString("base64"),
    }).hasExtraPassword).toBe(true);
  });

  it("accepts only encrypted tag updates", () => {
    const encryptedTags = {
      tagsEncrypted: validInput.tagsEncrypted,
      tagsIv: validInput.tagsIv,
      encryptedSearchText: validInput.encryptedSearchText,
      searchTextIv: validInput.searchTextIv,
    };
    expect(parseEncryptedTagsInput(encryptedTags)).toEqual(encryptedTags);
    expect(() => parseEncryptedTagsInput({ ...encryptedTags, tags: ["plaintext"] })).toThrow();
  });

  it("accepts only encrypted item notes", () => {
    const encryptedNotes = {
      encryptedItemNotes: Buffer.alloc(64).toString("base64"),
      itemNotesIv: Buffer.alloc(12).toString("base64"),
    };
    expect(parseEncryptedItemNotesInput(encryptedNotes)).toEqual(encryptedNotes);
    expect(() => parseEncryptedItemNotesInput({ ...encryptedNotes, markdown: "plaintext" })).toThrow();
  });
});

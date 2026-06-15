import { describe, expect, it } from "vitest";

import { generateNoteKey } from "./crypto.client";
import {
  decryptVaultItemPayload,
  encryptVaultItemPayload,
  generateSecurePassword,
  getDefaultPayloadForType,
} from "./vault-items.client";
import { vaultItemTypesMatch } from "./vault-items";

describe("vault item client encryption", () => {
  it("encrypts and decrypts a password item without plaintext in ciphertext", async () => {
    const masterKey = await generateNoteKey();
    const payload = {
      username: "private-user",
      password: "private-password",
      url: "https://private.example",
      notes: "private notes",
    };
    const encrypted = await encryptVaultItemPayload("password", payload, masterKey, {
      title: "Private login",
      tags: ["work"],
    });

    expect(JSON.stringify(encrypted)).not.toContain("private-user");
    expect(JSON.stringify(encrypted)).not.toContain("private-password");
    expect(JSON.stringify(encrypted)).not.toContain("Private login");
    expect(encrypted.folderId).toBeNull();

    await expect(decryptVaultItemPayload({
      ...encrypted,
      id: "item",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }, masterKey)).resolves.toMatchObject({
      title: "Private login",
      payload,
      tags: ["work"],
    });
  });

  it("encrypts a version 2 document without exposing block content", async () => {
    const masterKey = await generateNoteKey();
    const payload = {
      version: 2 as const,
      blocks: [{ id: "block-1", type: "heading_1" as const, content: "Private heading" }],
    };
    const encrypted = await encryptVaultItemPayload("document", payload, masterKey, {
      title: "Private document",
    });

    expect(JSON.stringify(encrypted)).not.toContain("Private heading");
    await expect(decryptVaultItemPayload({
      ...encrypted,
      id: "document",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }, masterKey)).resolves.toMatchObject({ type: "document", payload });
  });

  it("provides defaults for every supported type", () => {
    expect(getDefaultPayloadForType("credit_card")).toMatchObject({
      cardholder: "",
      number: "",
      cvv: "",
    });
    expect(getDefaultPayloadForType("document")).toMatchObject({
      version: 2,
      blocks: [{ type: "paragraph", content: "" }],
    });
    expect(getDefaultPayloadForType("note")).toEqual({ markdown: "" });
  });

  it("treats only legacy notes and documents as the same type", () => {
    expect(vaultItemTypesMatch("note", "document")).toBe(true);
    expect(vaultItemTypesMatch("document", "note")).toBe(true);
    expect(vaultItemTypesMatch("password", "document")).toBe(false);
    expect(vaultItemTypesMatch("secret", "document")).toBe(false);
  });

  it("generates passwords using the selected character groups", () => {
    const password = generateSecurePassword({
      length: 48,
      uppercase: true,
      lowercase: true,
      numbers: true,
      symbols: true,
      excludeAmbiguous: true,
      avoidRepeats: true,
    });
    expect(password).toHaveLength(48);
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/[0-9]/);
    expect(password).not.toMatch(/[Il1O0o]/);
    expect([...password].every((value, index) => index === 0 || value !== password[index - 1])).toBe(true);
  });
});

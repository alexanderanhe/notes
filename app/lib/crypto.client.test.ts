import { describe, expect, it } from "vitest";

import {
  arrayBufferToBase64,
  base64ToArrayBuffer,
  decryptNoteKey,
  decryptString,
  deriveKeyFromPassword,
  encryptNoteKey,
  encryptString,
  generateNoteKey,
} from "./crypto.client";

describe("crypto client", () => {
  it("round-trips base64 bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 255]);
    expect(new Uint8Array(base64ToArrayBuffer(arrayBufferToBase64(bytes)))).toEqual(bytes);
  });

  it("encrypts with unique IVs and decrypts strings", async () => {
    const key = await generateNoteKey();
    const first = await encryptString("contenido secreto", key);
    const second = await encryptString("contenido secreto", key);

    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toContain("contenido secreto");
    await expect(decryptString(first, key)).resolves.toBe("contenido secreto");
  });

  it("derives the same key from password and salt", async () => {
    const first = await deriveKeyFromPassword("password-seguro");
    const second = await deriveKeyFromPassword(
      "password-seguro",
      first.salt,
      first.iterations,
    );
    const encrypted = await encryptString("ok", first.key);
    await expect(decryptString(encrypted, second.key)).resolves.toBe("ok");
  });

  it("wraps and unwraps note keys", async () => {
    const noteKey = await generateNoteKey();
    const { key: passwordKey } = await deriveKeyFromPassword("extra-password");
    const wrapped = await encryptNoteKey(noteKey, passwordKey);
    const unwrapped = await decryptNoteKey(wrapped, passwordKey);
    const encrypted = await encryptString("nota", noteKey);

    await expect(decryptString(encrypted, unwrapped)).resolves.toBe("nota");
  });
});


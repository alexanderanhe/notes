import { describe, expect, it } from "vitest";

import { parseEncryptedNoteInput } from "./notes.server";

const validInput = {
  encryptedTitle: Buffer.alloc(16).toString("base64"),
  encryptedContent: Buffer.alloc(16).toString("base64"),
  titleIv: Buffer.alloc(12).toString("base64"),
  contentIv: Buffer.alloc(12).toString("base64"),
  encryptionVersion: 2,
  pinned: false,
  archived: false,
  hasExtraPassword: false,
};

describe("encrypted note input", () => {
  it("accepts encrypted note payloads without critical metadata", () => {
    expect(parseEncryptedNoteInput(validInput)).toEqual(validInput);
  });

  it("rejects attempts to change critical metadata through ciphertext updates", () => {
    expect(() =>
      parseEncryptedNoteInput({ ...validInput, isCritical: true }),
    ).toThrow();
  });
});

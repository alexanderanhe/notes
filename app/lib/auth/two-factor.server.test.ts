import { generate } from "otplib";
import { beforeAll, describe, expect, it } from "vitest";

import {
  createTotpSetup,
  decryptTotpSecret,
  encryptTotpSecret,
  findBackupCodeHash,
  generateBackupCodes,
  verifyTotpCode,
} from "./two-factor.server";

beforeAll(() => {
  process.env.TOTP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

describe("two-factor authentication", () => {
  it("encrypts and authenticates TOTP secrets with AES-256-GCM", () => {
    const encrypted = encryptTotpSecret("SENSITIVE-TOTP-SECRET");
    expect(encrypted.secretEncrypted).not.toContain("SENSITIVE");
    expect(decryptTotpSecret(encrypted)).toBe("SENSITIVE-TOTP-SECRET");
    expect(() =>
      decryptTotpSecret({ ...encrypted, secretAuthTag: Buffer.alloc(16).toString("base64") }),
    ).toThrow();
  });

  it("generates compatible six-digit TOTP codes", async () => {
    const setup = createTotpSetup("user@example.com");
    const token = await generate({ secret: setup.secret, digits: 6, period: 30 });
    await expect(verifyTotpCode(setup.secret, token)).resolves.toBe(true);
    expect(setup.otpauthUrl).toContain("otpauth://totp/");
  });

  it("stores backup codes as hashes and finds a matching hash", async () => {
    const backup = await generateBackupCodes();
    expect(backup.codes).toHaveLength(8);
    expect(backup.codes[0]).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(backup.hashes.join(" ")).not.toContain(backup.codes[0]!);
    await expect(findBackupCodeHash(backup.codes[0]!, backup.hashes)).resolves.toBe(
      backup.hashes[0],
    );
  });
});

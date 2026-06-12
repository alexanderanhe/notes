import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomInt,
} from "node:crypto";

import { generateSecret, generateURI, verify } from "otplib";

import { getEnv } from "./env.server";
import { hashSecret, verifySecret } from "./password.server";
import {
  consumeBackupCode,
  setTwoFactorVerified,
  type User,
} from "./users.server";
import { backupCodeSchema, totpCodeSchema } from "./schemas";
import type { WithId } from "mongodb";

const algorithm = "aes-256-gcm";
const associatedData = Buffer.from("notes:totp:v1", "utf8");
const backupAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const backupBcryptRounds = 10;

export interface EncryptedTotpSecret {
  secretEncrypted: string;
  secretIv: string;
  secretAuthTag: string;
}

function encryptionKey() {
  const value = getEnv("TOTP_ENCRYPTION_KEY");
  return /^[a-fA-F0-9]{64}$/.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
}

export function encryptTotpSecret(secret: string): EncryptedTotpSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, encryptionKey(), iv);
  cipher.setAAD(associatedData);
  const encrypted = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);

  return {
    secretEncrypted: encrypted.toString("base64"),
    secretIv: iv.toString("base64"),
    secretAuthTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptTotpSecret(value: EncryptedTotpSecret) {
  const decipher = createDecipheriv(
    algorithm,
    encryptionKey(),
    Buffer.from(value.secretIv, "base64"),
  );
  decipher.setAAD(associatedData);
  decipher.setAuthTag(Buffer.from(value.secretAuthTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(value.secretEncrypted, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function createTotpSetup(email: string) {
  const secret = generateSecret();
  return {
    secret,
    otpauthUrl: generateURI({
      issuer: "Notes",
      label: email,
      secret,
      digits: 6,
      period: 30,
    }),
  };
}

export async function verifyTotpCode(secret: string, token: string) {
  const result = await verify({
    secret,
    token,
    digits: 6,
    period: 30,
    epochTolerance: 30,
  });
  return result.valid;
}

export async function generateBackupCodes() {
  const codes = Array.from({ length: 8 }, () => {
    const value = Array.from(
      { length: 8 },
      () => backupAlphabet[randomInt(backupAlphabet.length)],
    ).join("");
    return `${value.slice(0, 4)}-${value.slice(4)}`;
  });
  return {
    codes,
    hashes: await Promise.all(
      codes.map((code) => hashSecret(code, backupBcryptRounds)),
    ),
  };
}

export async function findBackupCodeHash(code: string, hashes: string[]) {
  const matches = await Promise.all(hashes.map((hash) => verifySecret(code, hash)));
  const index = matches.findIndex(Boolean);
  return index >= 0 ? hashes[index] : null;
}

export async function verifyUserTwoFactorCode(user: WithId<User>, code: string) {
  const twoFactor = user.twoFactor;
  if (!twoFactor?.enabled) return false;

  if (totpCodeSchema.safeParse(code).success) {
    try {
      const valid = await verifyTotpCode(decryptTotpSecret(twoFactor), code);
      if (valid) await setTwoFactorVerified(user._id);
      return valid;
    } catch {
      return false;
    }
  }

  if (backupCodeSchema.safeParse(code).success) {
    const hash = await findBackupCodeHash(code, twoFactor.backupCodesHash);
    return Boolean(hash && (await consumeBackupCode(user._id, hash)));
  }

  return false;
}

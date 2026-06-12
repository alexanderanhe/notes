import { type Collection, ObjectId, type WithId } from "mongodb";

import { getDb } from "./db.server";
import { isVaultEnvelope, type VaultEnvelope } from "~/lib/vault";

export interface User {
  email: string;
  passwordHash: string;
  emailVerified: boolean;
  verificationCodeHash: string | null;
  verificationCodeExpiresAt: Date | null;
  verificationAttempts: number;
  verificationEmailSentAt?: Date;
  encryptedMasterKey?: string;
  masterKeyIv?: string;
  kdfSalt?: string;
  iterations?: number;
  encryptionVersion?: number;
  createdAt: Date;
  updatedAt: Date;
}

let indexesReady: Promise<string> | undefined;

async function usersCollection(): Promise<Collection<User>> {
  const collection = (await getDb()).collection<User>("users");
  indexesReady ??= collection.createIndex({ email: 1 }, { unique: true });
  await indexesReady;
  return collection;
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function findUserByEmail(email: string) {
  return (await usersCollection()).findOne({ email: normalizeEmail(email) });
}

export async function findUserById(id: string) {
  if (!ObjectId.isValid(id)) {
    return null;
  }

  return (await usersCollection()).findOne({ _id: new ObjectId(id) });
}

export async function upsertUnverifiedUser({
  email,
  passwordHash,
  verificationCodeHash,
  verificationCodeExpiresAt,
  vault,
}: {
  email: string;
  passwordHash: string;
  verificationCodeHash: string;
  verificationCodeExpiresAt: Date;
  vault: VaultEnvelope;
}) {
  const collection = await usersCollection();
  const normalizedEmail = normalizeEmail(email);
  const existing = await collection.findOne({ email: normalizedEmail });

  if (existing?.emailVerified) {
    return null;
  }

  const now = new Date();
  await collection.updateOne(
    { email: normalizedEmail },
    {
      $set: {
        passwordHash,
        emailVerified: false,
        verificationCodeHash,
        verificationCodeExpiresAt,
        verificationAttempts: 0,
        verificationEmailSentAt: now,
        ...vault,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );

  return collection.findOne({ email: normalizedEmail });
}

export function canSendVerificationEmail(user: User | null, cooldownMs: number) {
  return (
    !user?.verificationEmailSentAt ||
    user.verificationEmailSentAt.getTime() + cooldownMs <= Date.now()
  );
}

export function getUserVaultEnvelope(user: User): VaultEnvelope | null {
  const envelope = {
    encryptedMasterKey: user.encryptedMasterKey,
    masterKeyIv: user.masterKeyIv,
    kdfSalt: user.kdfSalt,
    iterations: user.iterations,
    encryptionVersion: user.encryptionVersion,
  };
  return isVaultEnvelope(envelope) ? envelope : null;
}

export async function setUserVaultEnvelope(
  userId: ObjectId,
  vault: VaultEnvelope,
) {
  const result = await (await usersCollection()).updateOne(
    { _id: userId, encryptedMasterKey: { $exists: false } },
    { $set: { ...vault, updatedAt: new Date() } },
  );
  return result.modifiedCount === 1;
}

export async function incrementVerificationAttempts(user: WithId<User>) {
  await (await usersCollection()).updateOne(
    { _id: user._id, emailVerified: false },
    { $inc: { verificationAttempts: 1 }, $set: { updatedAt: new Date() } },
  );
}

export async function markEmailVerified(user: WithId<User>) {
  const result = await (await usersCollection()).updateOne(
    { _id: user._id, emailVerified: false },
    {
      $set: {
        emailVerified: true,
        verificationCodeHash: null,
        verificationCodeExpiresAt: null,
        verificationAttempts: 0,
        updatedAt: new Date(),
      },
    },
  );

  return result.modifiedCount === 1;
}

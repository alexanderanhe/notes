import { describe, expect, it } from "vitest";

import { hashSecret, verifySecret } from "./password.server";
import {
  emailSchema,
  passwordSchema,
  verificationCodeSchema,
} from "./schemas";
import { canSendVerificationEmail, type User } from "./users.server";

describe("auth validation", () => {
  it("normalizes valid email and rejects malformed email", () => {
    expect(emailSchema.parse("  User@Example.COM ")).toBe("user@example.com");
    expect(emailSchema.safeParse("not-an-email").success).toBe(false);
  });

  it("enforces bcrypt-compatible password bounds", () => {
    expect(passwordSchema.safeParse("short").success).toBe(false);
    expect(passwordSchema.safeParse("correct-horse").success).toBe(true);
    expect(passwordSchema.safeParse("x".repeat(73)).success).toBe(false);
  });

  it("accepts only six digit verification codes", () => {
    expect(verificationCodeSchema.safeParse("123456").success).toBe(true);
    expect(verificationCodeSchema.safeParse("12345a").success).toBe(false);
  });

  it("hashes and verifies secrets without storing plaintext", async () => {
    const hash = await hashSecret("correct-horse");
    expect(hash).not.toContain("correct-horse");
    await expect(verifySecret("correct-horse", hash)).resolves.toBe(true);
    await expect(verifySecret("wrong", hash)).resolves.toBe(false);
  });

  it("enforces verification email cooldown", () => {
    const user = {
      verificationEmailSentAt: new Date(),
    } as User;
    expect(canSendVerificationEmail(user, 60_000)).toBe(false);
    expect(canSendVerificationEmail(null, 60_000)).toBe(true);
  });
});


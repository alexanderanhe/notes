import { describe, expect, it } from "vitest";

import { isRecentTwoFactorVerification } from "./session.server";

describe("recent two-factor verification", () => {
  const now = Date.parse("2026-06-12T15:00:00.000Z");
  const maxAge = 10 * 60_000;

  it("accepts a verification inside the configured window", () => {
    expect(
      isRecentTwoFactorVerification(
        "2026-06-12T14:55:00.000Z",
        maxAge,
        now,
      ),
    ).toBe(true);
  });

  it("accepts the exact expiration boundary", () => {
    expect(
      isRecentTwoFactorVerification(
        "2026-06-12T14:50:00.000Z",
        maxAge,
        now,
      ),
    ).toBe(true);
  });

  it("rejects missing, invalid, expired, and future timestamps", () => {
    expect(isRecentTwoFactorVerification(null, maxAge, now)).toBe(false);
    expect(isRecentTwoFactorVerification("invalid", maxAge, now)).toBe(false);
    expect(
      isRecentTwoFactorVerification(
        "2026-06-12T14:49:59.999Z",
        maxAge,
        now,
      ),
    ).toBe(false);
    expect(
      isRecentTwoFactorVerification(
        "2026-06-12T15:00:00.001Z",
        maxAge,
        now,
      ),
    ).toBe(false);
  });
});

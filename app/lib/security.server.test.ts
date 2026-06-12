import { describe, expect, it, vi } from "vitest";

import { assertSameOrigin, enforceRateLimit, logSafe } from "./security.server";

describe("server security", () => {
  it("rejects cross-origin mutations", () => {
    const request = new Request("https://notes.example/api/notes", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
    });
    expect(() => assertSameOrigin(request)).toThrow();
  });

  it("accepts same-origin mutations", () => {
    const request = new Request("https://notes.example/api/notes", {
      method: "POST",
      headers: { Origin: "https://notes.example" },
    });
    expect(() => assertSameOrigin(request)).not.toThrow();
  });

  it("limits repeated requests", () => {
    const request = new Request("https://notes.example/api/test", {
      headers: { "X-Real-IP": "192.0.2.10" },
    });
    enforceRateLimit(request, { bucket: "test-unique", limit: 1, windowMs: 60_000 });
    expect(() =>
      enforceRateLimit(request, { bucket: "test-unique", limit: 1, windowMs: 60_000 }),
    ).toThrow();
  });

  it("redacts secrets and personal data from logs", () => {
    const output = vi.spyOn(console, "info").mockImplementation(() => undefined);
    logSafe("info", "test", {
      password: "plain-secret",
      message: "mongodb://user:pass@db.example/notes user@example.com",
    });
    const logged = String(output.mock.calls[0]?.[0]);
    expect(logged).not.toContain("plain-secret");
    expect(logged).not.toContain("user:pass");
    expect(logged).not.toContain("user@example.com");
    output.mockRestore();
  });
});

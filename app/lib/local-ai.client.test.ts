import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getLocalAICapabilities,
  getAIContextForVaultItem,
  LocalAIUnavailableError,
  summarizeText,
} from "./local-ai.client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("local AI client", () => {
  it("detects available built-in APIs", async () => {
    const factory = {
      availability: vi.fn().mockResolvedValue("available"),
      create: vi.fn(),
    };
    (globalThis as { window: unknown }).window = {
      Summarizer: factory,
      Translator: factory,
      LanguageDetector: factory,
    };

    await expect(getLocalAICapabilities()).resolves.toMatchObject({
      summarizer: "available",
      translator: "available",
      languageDetector: "available",
      writer: "unavailable",
    });
  });

  it("returns unavailable when APIs do not exist", async () => {
    (globalThis as { window: unknown }).window = {};
    await expect(getLocalAICapabilities()).resolves.toEqual({
      summarizer: "unavailable",
      translator: "unavailable",
      languageDetector: "unavailable",
      writer: "unavailable",
      rewriter: "unavailable",
      languageModel: "unavailable",
    });
  });

  it("never calls backend while summarizing", async () => {
    const fetchSpy = vi.fn();
    (globalThis as { fetch: unknown }).fetch = fetchSpy;
    (globalThis as { window: unknown }).window = {
      Summarizer: {
        availability: vi.fn().mockResolvedValue("available"),
        create: vi.fn().mockResolvedValue({
          summarize: vi.fn().mockResolvedValue("Local summary"),
          destroy: vi.fn(),
        }),
      },
    };
    await expect(summarizeText("Private note")).resolves.toBe("Local summary");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("handles unavailable models", async () => {
    (globalThis as { window: unknown }).window = {
      Summarizer: {
        availability: vi.fn().mockResolvedValue("no"),
        create: vi.fn(),
      },
    };
    await expect(summarizeText("Private note")).rejects.toBeInstanceOf(
      LocalAIUnavailableError,
    );
  });

  it("builds safe vault item AI context without password secrets", () => {
    const context = getAIContextForVaultItem({
      id: "item",
      type: "password",
      folderId: null,
      title: "Production login",
      payload: {
        username: "deploy-user",
        password: "super-secret-password",
        url: "https://admin.example.com",
        notes: "Use during maintenance",
        totpSecret: "TOTP-SECRET",
      },
      itemNotes: { version: 1, markdown: "Coordinate with SRE", updatedAt: "2026-01-01T00:00:00.000Z" },
      tags: [],
      favorite: false,
      archived: false,
      pinned: false,
      requiresRecent2FA: false,
      hasExtraPassword: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(context).toContain("deploy-user");
    expect(context).toContain("Coordinate with SRE");
    expect(context).not.toContain("super-secret-password");
    expect(context).not.toContain("TOTP-SECRET");
  });
});

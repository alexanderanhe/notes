import { describe, expect, it } from "vitest";

import { backgroundPreferenceSchema } from "./schemas";

describe("appearance preferences", () => {
  it("accepts fixed Unsplash image URLs and default backgrounds", () => {
    expect(backgroundPreferenceSchema.parse({
      backgroundUrl: "https://images.unsplash.com/photo-123?auto=format&fit=crop&w=1600",
    }).backgroundUrl).toContain("images.unsplash.com");
    expect(backgroundPreferenceSchema.parse({ backgroundUrl: "" }).backgroundUrl).toBeNull();
  });

  it("rejects arbitrary external image hosts", () => {
    expect(backgroundPreferenceSchema.safeParse({
      backgroundUrl: "https://example.com/private-tracker.jpg",
    }).success).toBe(false);
    expect(backgroundPreferenceSchema.safeParse({
      backgroundUrl: "http://images.unsplash.com/photo-123",
    }).success).toBe(false);
  });
});

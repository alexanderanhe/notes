import { describe, expect, it } from "vitest";

import {
  blocksToMarkdown,
  createDocumentReferenceBlock,
  documentPayloadToBlocks,
  getDocumentReferenceIds,
  markdownToBlocks,
  renderBlocks,
} from "./document-blocks";

describe("document blocks", () => {
  it("converts supported Markdown lines into blocks", () => {
    const blocks = markdownToBlocks("# Title\n- [x] Done\n> Quote\n---\n```\nconst value = 1;\n```");
    expect(renderBlocks(blocks).map(({ type, text, checked }) => ({ type, text, checked }))).toEqual([
      { type: "heading_1", text: "Title", checked: false },
      { type: "checklist", text: "Done", checked: true },
      { type: "quote", text: "Quote", checked: false },
      { type: "divider", text: "", checked: false },
      { type: "code", text: "const value = 1;", checked: false },
    ]);
  });

  it("round trips supported blocks through Markdown", () => {
    const markdown = "Paragraph\n## Heading\n- [ ] Todo\n> Quote\n---";
    expect(blocksToMarkdown(markdownToBlocks(markdown))).toBe(markdown);
  });

  it("opens legacy payloads without mutating them", () => {
    const payload = { markdown: "# Legacy" };
    expect(renderBlocks(documentPayloadToBlocks(payload))[0]).toMatchObject({
      type: "heading_1",
      text: "Legacy",
    });
    expect(payload).toEqual({ markdown: "# Legacy" });
  });

  it("stores and serializes references using only item IDs", () => {
    const reference = createDocumentReferenceBlock("password_reference", "password-id");
    const payload = { version: 2 as const, blocks: [reference] };

    expect(reference).toEqual({
      id: expect.any(String),
      type: "password_reference",
      itemId: "password-id",
    });
    expect(JSON.stringify(reference)).not.toContain("username");
    expect(JSON.stringify(reference)).not.toContain("password:");
    expect(getDocumentReferenceIds(payload)).toEqual(["password-id"]);
    expect(blocksToMarkdown(payload.blocks)).toBe("[[vault:password_reference:password-id]]");
    expect(getDocumentReferenceIds({ version: 2, blocks: markdownToBlocks(blocksToMarkdown(payload.blocks)) })).toEqual(["password-id"]);
  });
});

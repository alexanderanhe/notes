export const DOCUMENT_BLOCK_TYPES = [
  "paragraph",
  "heading_1",
  "heading_2",
  "heading_3",
  "checklist",
  "code",
  "quote",
  "divider",
  "password_reference",
  "secret_reference",
  "server_reference",
  "database_reference",
  "bookmark_reference",
  "document_reference",
  "code_snippet_reference",
] as const;

export type DocumentBlockType = (typeof DOCUMENT_BLOCK_TYPES)[number];
export type DocumentReferenceBlockType = Extract<DocumentBlockType, `${string}_reference`>;
export type DocumentContentBlockType = Exclude<DocumentBlockType, DocumentReferenceBlockType>;

export interface DocumentContentBlock {
  id: string;
  type: DocumentContentBlockType;
  content: string | { text: string; checked: boolean };
}

export interface DocumentReferenceBlock {
  id: string;
  type: DocumentReferenceBlockType;
  itemId: string;
}

export type DocumentBlock = DocumentContentBlock | DocumentReferenceBlock;

export interface DocumentPayloadV2 {
  version: 2;
  blocks: DocumentBlock[];
}

export interface LegacyDocumentPayload {
  markdown: string;
}

export type DocumentPayload = LegacyDocumentPayload | DocumentPayloadV2;

export interface RenderedDocumentBlock {
  id: string;
  type: DocumentBlockType;
  text: string;
  checked: boolean;
}

export function isDocumentReferenceBlock(block: DocumentBlock): block is DocumentReferenceBlock {
  return block.type.endsWith("_reference");
}

export function createDocumentBlock(type: DocumentContentBlock["type"] = "paragraph", content = ""): DocumentContentBlock {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `block-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type,
    content: type === "checklist" ? { text: content, checked: false } : content,
  };
}

export function createDocumentReferenceBlock(type: DocumentReferenceBlockType, itemId: string): DocumentReferenceBlock {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `block-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type,
    itemId,
  };
}

export function isDocumentPayloadV2(payload: unknown): payload is DocumentPayloadV2 {
  if (!payload || typeof payload !== "object") return false;
  const candidate = payload as Partial<DocumentPayloadV2>;
  return candidate.version === 2 && Array.isArray(candidate.blocks);
}

export function documentPayloadToBlocks(payload: DocumentPayload): DocumentBlock[] {
  if (isDocumentPayloadV2(payload)) return normalizeBlocks(payload.blocks as DocumentBlock[]);
  return markdownToBlocks(typeof payload.markdown === "string" ? payload.markdown : "");
}

export function getDocumentReferenceIds(payload: DocumentPayload) {
  return documentPayloadToBlocks(payload)
    .filter(isDocumentReferenceBlock)
    .map((block) => block.itemId);
}

export function markdownToBlocks(markdown: string): DocumentBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: DocumentBlock[] = [];
  let codeLines: string[] | null = null;

  for (const line of lines) {
    const reference = /^\[\[vault:([a-z_]+_reference):([A-Za-z0-9_-]+)]]$/.exec(line);
    if (reference && DOCUMENT_BLOCK_TYPES.includes(reference[1] as DocumentBlockType)) {
      blocks.push(createDocumentReferenceBlock(reference[1] as DocumentReferenceBlockType, reference[2]!));
      continue;
    }
    if (line.startsWith("```")) {
      if (codeLines === null) codeLines = [];
      else {
        blocks.push(createDocumentBlock("code", codeLines.join("\n")));
        codeLines = null;
      }
      continue;
    }
    if (codeLines !== null) {
      codeLines.push(line);
      continue;
    }
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      blocks.push(createDocumentBlock("divider"));
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(createDocumentBlock(`heading_${heading[1]!.length}` as DocumentContentBlockType, heading[2]));
      continue;
    }
    const checklist = /^\s*[-*]\s+\[([ xX])]\s*(.*)$/.exec(line);
    if (checklist) {
      blocks.push({
        ...createDocumentBlock("checklist"),
        content: { text: checklist[2] ?? "", checked: checklist[1]!.toLowerCase() === "x" },
      });
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      blocks.push(createDocumentBlock("quote", quote[1]));
      continue;
    }
    blocks.push(createDocumentBlock("paragraph", line));
  }

  if (codeLines !== null) blocks.push(createDocumentBlock("code", codeLines.join("\n")));
  return blocks.length ? blocks : [createDocumentBlock()];
}

export function blocksToMarkdown(blocks: DocumentBlock[]) {
  return normalizeBlocks(blocks).map((block) => {
    if (isDocumentReferenceBlock(block)) return `[[vault:${block.type}:${block.itemId}]]`;
    const { text, checked } = renderBlock(block);
    if (block.type === "heading_1") return `# ${text}`;
    if (block.type === "heading_2") return `## ${text}`;
    if (block.type === "heading_3") return `### ${text}`;
    if (block.type === "checklist") return `- [${checked ? "x" : " "}] ${text}`;
    if (block.type === "code") return `\`\`\`\n${text}\n\`\`\``;
    if (block.type === "quote") return `> ${text}`;
    if (block.type === "divider") return "---";
    return text;
  }).join("\n");
}

export function renderBlocks(blocks: DocumentBlock[]): RenderedDocumentBlock[] {
  return normalizeBlocks(blocks).map(renderBlock);
}

function normalizeBlocks(blocks: DocumentBlock[]): DocumentBlock[] {
  const normalized: DocumentBlock[] = [];
  for (const block of blocks) {
    if (!block || !DOCUMENT_BLOCK_TYPES.includes(block.type)) continue;
    if (isDocumentReferenceBlock(block)) {
      if (typeof block.itemId !== "string" || !block.itemId) continue;
      normalized.push({ id: typeof block.id === "string" && block.id ? block.id : createDocumentBlock().id, type: block.type, itemId: block.itemId });
      continue;
    }
    const content = block.type === "checklist"
      ? {
          text: typeof block.content === "object" && block.content ? String(block.content.text ?? "") : String(block.content ?? ""),
          checked: typeof block.content === "object" && block.content ? Boolean(block.content.checked) : false,
        }
      : typeof block.content === "string" ? block.content : String(block.content?.text ?? "");
    normalized.push({ id: typeof block.id === "string" && block.id ? block.id : createDocumentBlock().id, type: block.type, content });
  }
  return normalized.length ? normalized : [createDocumentBlock()];
}

function renderBlock(block: DocumentBlock): RenderedDocumentBlock {
  if (isDocumentReferenceBlock(block)) {
    return { id: block.id, type: block.type, text: "", checked: false };
  }
  const checklist = block.type === "checklist" && typeof block.content === "object"
    ? block.content
    : null;
  return {
    id: block.id,
    type: block.type,
    text: checklist ? checklist.text : typeof block.content === "string" ? block.content : "",
    checked: checklist ? checklist.checked : false,
  };
}

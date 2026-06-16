import { useMemo, useRef, useState } from "react";
import { FiBookmark, FiCheckSquare, FiCode, FiDatabase, FiFileText, FiKey, FiMinus, FiPlus, FiSearch, FiServer, FiType, FiX } from "react-icons/fi";

import { referenceTypeAcceptsItem, VaultItemReferenceCard } from "~/components/vault-item-reference-card";
import {
  blocksToMarkdown,
  createDocumentBlock,
  createDocumentReferenceBlock,
  documentPayloadToBlocks,
  isDocumentReferenceBlock,
  markdownToBlocks,
  renderBlocks,
  type DocumentBlock,
  type DocumentBlockType,
  type DocumentContentBlock,
  type DocumentPayload,
  type DocumentPayloadV2,
  type DocumentReferenceBlockType,
} from "~/lib/document-blocks";
import type { VaultItem } from "~/lib/vault-items";

const BLOCK_OPTIONS: { type: DocumentContentBlock["type"]; label: string; hint: string; icon: React.ReactNode }[] = [
  { type: "paragraph", label: "Text", hint: "Plain paragraph", icon: <FiType /> },
  { type: "heading_1", label: "Heading 1", hint: "Large section heading", icon: <strong>H1</strong> },
  { type: "heading_2", label: "Heading 2", hint: "Medium section heading", icon: <strong>H2</strong> },
  { type: "heading_3", label: "Heading 3", hint: "Small section heading", icon: <strong>H3</strong> },
  { type: "checklist", label: "Checklist", hint: "Track a task", icon: <FiCheckSquare /> },
  { type: "code", label: "Code", hint: "Code block", icon: <FiCode /> },
  { type: "quote", label: "Quote", hint: "Highlighted quotation", icon: <span>“</span> },
  { type: "divider", label: "Divider", hint: "Visual separator", icon: <FiMinus /> },
];

const REFERENCE_OPTIONS: { type: DocumentReferenceBlockType; label: string; icon: React.ReactNode }[] = [
  { type: "bookmark_reference", label: "Bookmark", icon: <FiBookmark /> },
  { type: "password_reference", label: "Password", icon: <FiKey /> },
  { type: "secret_reference", label: "Secret", icon: <FiKey /> },
  { type: "server_reference", label: "Server", icon: <FiServer /> },
  { type: "database_reference", label: "Database", icon: <FiDatabase /> },
  { type: "document_reference", label: "Document", icon: <FiFileText /> },
  { type: "code_snippet_reference", label: "Code snippet", icon: <FiCode /> },
];

export function DocumentBlockEditor({ payload, items, currentDocumentId, onChange, onSave, onOpenItem, disabled }: {
  payload: DocumentPayload;
  items: VaultItem[];
  currentDocumentId?: string;
  onChange: (payload: DocumentPayloadV2) => void;
  onSave: () => void;
  onOpenItem?: (item: VaultItem) => void;
  disabled?: boolean;
}) {
  const [blocks, setBlocks] = useState(() => documentPayloadToBlocks(payload));
  const [markdownMode, setMarkdownMode] = useState(false);
  const [markdown, setMarkdown] = useState(() => blocksToMarkdown(blocks));
  const [menu, setMenu] = useState<{ blockId: string; mode: "insert" | "slash" } | null>(null);
  const [menuIndex, setMenuIndex] = useState(0);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
  const [referencePicker, setReferencePicker] = useState<{ blockId: string; type: DocumentReferenceBlockType; mode: "insert" | "slash" } | null>(null);
  const [referenceQuery, setReferenceQuery] = useState("");
  const inputs = useRef(new Map<string, HTMLInputElement | HTMLTextAreaElement>());

  const rendered = useMemo(() => renderBlocks(blocks), [blocks]);
  const slashQuery = menu?.mode === "slash"
    ? rendered.find((block) => block.id === menu.blockId)?.text.slice(1).trim().toLocaleLowerCase() ?? ""
    : "";
  const options = BLOCK_OPTIONS.filter((option) =>
    !slashQuery || `${option.label} ${option.hint}`.toLocaleLowerCase().includes(slashQuery),
  );
  const referenceOptions = REFERENCE_OPTIONS.filter((option) =>
    !slashQuery || `${option.label} reference`.toLocaleLowerCase().includes(slashQuery),
  );
  const menuItemCount = options.length + referenceOptions.length;
  const activeMenuIndex = Math.min(menuIndex, Math.max(menuItemCount - 1, 0));

  const commit = (next: DocumentBlock[]) => {
    const normalized = next.length ? next : [createDocumentBlock()];
    setBlocks(normalized);
    setMarkdown(blocksToMarkdown(normalized));
    onChange({ version: 2, blocks: normalized });
  };

  const focus = (id: string) => {
    setFocusId(id);
    window.setTimeout(() => {
      const input = inputs.current.get(id);
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
      setFocusId(null);
    }, 0);
  };

  const insert = (afterId: string, type: DocumentContentBlock["type"]) => {
    const index = blocks.findIndex((block) => block.id === afterId);
    const block = createDocumentBlock(type);
    commit([...blocks.slice(0, index + 1), block, ...blocks.slice(index + 1)]);
    setMenu(null);
    focus(block.id);
  };

  const insertParagraphWithMenu = (afterId: string) => {
    const index = blocks.findIndex((block) => block.id === afterId);
    const block = createDocumentBlock("paragraph");
    commit([...blocks.slice(0, index + 1), block, ...blocks.slice(index + 1)]);
    setMenu({ blockId: block.id, mode: "slash" });
    setMenuIndex(0);
    focus(block.id);
  };

  const replaceType = (id: string, type: DocumentContentBlock["type"]) => {
    const index = blocks.findIndex((block) => block.id === id);
    const replacement = { ...createDocumentBlock(type), id };
    const needsTrailingParagraph = !blocks[index + 1] || isDocumentReferenceBlock(blocks[index + 1]!);
    const next = blocks.map((block) => block.id === id ? replacement : block);
    if (needsTrailingParagraph) next.splice(index + 1, 0, createDocumentBlock("paragraph"));
    commit(next);
    setMenu(null);
    focus(id);
  };

  const updateText = (id: string, text: string) => {
    const next = blocks.map((block) => block.id === id
      ? isDocumentReferenceBlock(block) ? block : {
          ...block,
          content: block.type === "checklist"
            ? { text, checked: typeof block.content === "object" && block.content ? block.content.checked : false }
            : text,
        }
      : block);
    commit(next);
    if (text.startsWith("/") && !text.includes("\n")) {
      setMenu({ blockId: id, mode: "slash" });
      setMenuIndex(0);
    } else {
      setMenu(null);
    }
  };

  const toggleChecklist = (id: string) => commit(blocks.map((block) => block.id === id && block.type === "checklist"
    ? {
        ...block,
        content: {
          text: typeof block.content === "object" ? block.content.text : "",
          checked: !(typeof block.content === "object" && block.content.checked),
        },
      }
    : block));

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>, block: DocumentContentBlock) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "s") {
      event.preventDefault();
      onSave();
      return;
    }
    if (event.key === "Escape") {
      setMenu(null);
      return;
    }
    if (menu?.blockId === block.id && menuItemCount > 0 && ["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) {
      event.preventDefault();
      if (event.key === "ArrowDown") {
        setMenuIndex((index) => (index + 1) % menuItemCount);
        return;
      }
      if (event.key === "ArrowUp") {
        setMenuIndex((index) => (index - 1 + menuItemCount) % menuItemCount);
        return;
      }
      const blockOption = options[activeMenuIndex];
      const referenceOption = referenceOptions[activeMenuIndex - options.length];
      if (blockOption) replaceType(block.id, blockOption.type);
      else if (referenceOption) chooseReferenceType(block.id, referenceOption.type, menu.mode);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const target = event.currentTarget;
      const text = target.value;
      const start = target.selectionStart ?? text.length;
      const before = text.slice(0, start);
      const after = text.slice(target.selectionEnd ?? start);
      const nextBlock = createDocumentBlock("paragraph", after);
      const index = blocks.findIndex((entry) => entry.id === block.id);
      const current = {
        ...block,
        content: block.type === "checklist"
          ? { text: before, checked: typeof block.content === "object" && block.content ? block.content.checked : false }
          : before,
      };
      commit([...blocks.slice(0, index), current, nextBlock, ...blocks.slice(index + 1)]);
      setMenu(null);
      focus(nextBlock.id);
      return;
    }
    if (event.key !== "Backspace" || event.currentTarget.selectionStart !== 0 || event.currentTarget.selectionEnd !== 0) return;
    const index = blocks.findIndex((entry) => entry.id === block.id);
    if (index <= 0) return;
    event.preventDefault();
    const previous = blocks[index - 1]!;
    if (isDocumentReferenceBlock(previous)) {
      commit(blocks.filter((entry) => entry.id !== previous.id));
      focus(block.id);
      return;
    }
    const currentText = rendered.find((entry) => entry.id === block.id)?.text ?? "";
    if (previous.type === "divider") {
      commit(blocks.filter((entry) => entry.id !== previous.id));
      focus(block.id);
      return;
    }
    const previousRendered = rendered.find((entry) => entry.id === previous.id)!;
    const mergedText = `${previousRendered.text}${currentText}`;
    const merged = {
      ...previous,
      content: previous.type === "checklist"
        ? { text: mergedText, checked: previousRendered.checked }
        : mergedText,
    };
    commit([...blocks.slice(0, index - 1), merged, ...blocks.slice(index + 1)]);
    focus(previous.id);
  };

  const paste = (event: React.ClipboardEvent, blockId: string) => {
    const text = event.clipboardData.getData("text/plain");
    if (!text.includes("\n") && !/^(#{1,3}\s|>\s|[-*]\s+\[[ xX]\]|```|---)/.test(text)) return;
    event.preventDefault();
    const pasted = markdownToBlocks(text);
    const index = blocks.findIndex((block) => block.id === blockId);
    commit([...blocks.slice(0, index), ...pasted, ...blocks.slice(index + 1)]);
    focus(pasted[0]!.id);
  };

  const drop = (targetId: string) => {
    if (!draggedId || draggedId === targetId) return;
    const dragged = blocks.find((block) => block.id === draggedId);
    if (!dragged) return;
    const remaining = blocks.filter((block) => block.id !== draggedId);
    const targetIndex = remaining.findIndex((block) => block.id === targetId);
    commit([...remaining.slice(0, targetIndex), dragged, ...remaining.slice(targetIndex)]);
    setDraggedId(null);
  };

  const chooseReferenceType = (blockId: string, type: DocumentReferenceBlockType, mode: "insert" | "slash") => {
    setMenu(null);
    setReferenceQuery("");
    setReferencePicker({ blockId, type, mode });
  };

  const insertReference = (item: VaultItem) => {
    if (!referencePicker) return;
    const reference = createDocumentReferenceBlock(referencePicker.type, item.id);
    const index = blocks.findIndex((block) => block.id === referencePicker.blockId);
    commit(referencePicker.mode === "slash"
      ? [...blocks.slice(0, index), reference, createDocumentBlock("paragraph"), ...blocks.slice(index + 1)]
      : [...blocks.slice(0, index + 1), reference, createDocumentBlock("paragraph"), ...blocks.slice(index + 1)]);
    setReferencePicker(null);
  };

  if (markdownMode) {
    return <section className="document-block-editor">
      <header className="document-editor-toolbar">
        <div><strong>Edit as Markdown</strong><span>Changes convert back into visual blocks.</span></div>
        <button type="button" onClick={() => setMarkdownMode(false)}>Visual editor</button>
      </header>
      <textarea
        className="document-markdown-editor"
        value={markdown}
        disabled={disabled}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "s") {
            event.preventDefault();
            onSave();
          }
        }}
        onChange={(event) => {
          const nextMarkdown = event.target.value;
          const nextBlocks = markdownToBlocks(nextMarkdown);
          setMarkdown(nextMarkdown);
          setBlocks(nextBlocks);
          onChange({ version: 2, blocks: nextBlocks });
        }}
      />
    </section>;
  }

  return <section className="document-block-editor">
    <header className="document-editor-toolbar">
      <div><strong>Document</strong><span>Type / for blocks · Enter creates a new block</span></div>
      <button type="button" onClick={() => setMarkdownMode(true)}>Edit as Markdown</button>
    </header>
    <div className="document-block-list">
      {blocks.map((block) => {
        const view = rendered.find((entry) => entry.id === block.id)!;
        const menuOpen = menu?.blockId === block.id;
        return <div
          key={block.id}
          className={`document-block document-block-${block.type} ${focusId === block.id ? "is-focused" : ""}`}
          onDragOver={(event) => event.preventDefault()}
          onDrop={() => drop(block.id)}
        >
          <div className="document-block-controls">
            <button type="button" aria-label="Insert block below" onClick={() => insertParagraphWithMenu(block.id)}><FiPlus /></button>
            <button type="button" draggable aria-label="Drag to reorder block" onDragStart={(event) => { event.dataTransfer.setData("text/plain", block.id); event.dataTransfer.effectAllowed = "move"; setDraggedId(block.id); }} onDragEnd={() => setDraggedId(null)}><span>⋮⋮</span></button>
          </div>
          <div className="document-block-content">
            {isDocumentReferenceBlock(block)
              ? <VaultItemReferenceCard type={block.type} itemId={block.itemId} items={items} onOpen={onOpenItem} onRemove={() => commit(blocks.filter((entry) => entry.id !== block.id))} />
              : block.type === "divider" ? <hr /> : <>
              {block.type === "checklist" ? <input type="checkbox" checked={view.checked} onChange={() => toggleChecklist(block.id)} /> : null}
              {block.type === "code"
                ? <textarea ref={(element) => { if (element) inputs.current.set(block.id, element); else inputs.current.delete(block.id); }} rows={Math.max(2, view.text.split("\n").length)} value={view.text} onFocus={() => setFocusedBlockId(block.id)} onBlur={() => setFocusedBlockId((id) => id === block.id ? null : id)} onPaste={(event) => paste(event, block.id)} onKeyDown={(event) => onKeyDown(event, block)} onChange={(event) => updateText(block.id, event.target.value)} placeholder={focusedBlockId === block.id ? "Write code..." : ""} />
                : <input ref={(element) => { if (element) inputs.current.set(block.id, element); else inputs.current.delete(block.id); }} value={view.text} onFocus={() => setFocusedBlockId(block.id)} onBlur={() => setFocusedBlockId((id) => id === block.id ? null : id)} onPaste={(event) => paste(event, block.id)} onKeyDown={(event) => onKeyDown(event, block)} onChange={(event) => updateText(block.id, event.target.value)} placeholder={focusedBlockId === block.id ? block.type.startsWith("heading") ? "Heading" : block.type === "quote" ? "Quote" : block.type === "checklist" ? "To-do" : "Type '/' for commands" : ""} />}
            </>}
          </div>
          {menuOpen ? <BlockMenu
            options={options}
            referenceOptions={referenceOptions}
            activeIndex={activeMenuIndex}
            onActiveIndex={setMenuIndex}
            onSelect={(type) => menu.mode === "slash" ? replaceType(block.id, type) : insert(block.id, type)}
            onReference={(type) => chooseReferenceType(block.id, type, menu.mode)}
          /> : null}
        </div>;
      })}
    </div>
    {referencePicker ? <ReferencePicker
      type={referencePicker.type}
      query={referenceQuery}
      items={items.filter((item) => item.id !== currentDocumentId && referenceTypeAcceptsItem(referencePicker.type, item))}
      onQuery={setReferenceQuery}
      onSelect={insertReference}
      onClose={() => setReferencePicker(null)}
    /> : null}
  </section>;
}

function BlockMenu({ options, referenceOptions, activeIndex, onActiveIndex, onSelect, onReference }: {
  options: typeof BLOCK_OPTIONS;
  referenceOptions: typeof REFERENCE_OPTIONS;
  activeIndex: number;
  onActiveIndex: (index: number) => void;
  onSelect: (type: DocumentContentBlock["type"]) => void;
  onReference: (type: DocumentReferenceBlockType) => void;
}) {
  return <div className="document-block-menu">
    <p>Basic blocks</p>
    {options.map((option, index) => <button type="button" key={option.type} className={activeIndex === index ? "active" : ""} onMouseEnter={() => onActiveIndex(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => onSelect(option.type)}>
      <span>{option.icon}</span><span><strong>{option.label}</strong><small>{option.hint}</small></span>
    </button>)}
    {referenceOptions.length ? <p>References</p> : null}
    {referenceOptions.map((option, index) => {
      const optionIndex = options.length + index;
      return <button type="button" key={option.type} className={activeIndex === optionIndex ? "active" : ""} onMouseEnter={() => onActiveIndex(optionIndex)} onMouseDown={(event) => event.preventDefault()} onClick={() => onReference(option.type)}>
      <span>{option.icon}</span><span><strong>{option.label}</strong><small>Reference current vault item</small></span>
    </button>;
    })}
    {!options.length && !referenceOptions.length ? <em>No matching blocks</em> : null}
  </div>;
}

function ReferencePicker({ type, query, items, onQuery, onSelect, onClose }: {
  type: DocumentReferenceBlockType;
  query: string;
  items: VaultItem[];
  onQuery: (query: string) => void;
  onSelect: (item: VaultItem) => void;
  onClose: () => void;
}) {
  const label = REFERENCE_OPTIONS.find((option) => option.type === type)?.label ?? "item";
  const filtered = items.filter((item) => JSON.stringify([item.title, item.tags]).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <div className="document-reference-picker-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="document-reference-picker">
      <header><div><strong>Reference {label}</strong><span>Search decrypted items locally. Only the selected item ID will be stored.</span></div><button type="button" onClick={onClose}><FiX /></button></header>
      <label><FiSearch /><input autoFocus value={query} onChange={(event) => onQuery(event.target.value)} placeholder={`Search ${label.toLocaleLowerCase()}s...`} /></label>
      <div>{filtered.map((item) => <button type="button" key={item.id} onClick={() => onSelect(item)}><strong>{item.title || "Untitled"}</strong><span>{item.tags.map((tag) => `#${tag}`).join(" ") || "No tags"}</span></button>)}{!filtered.length ? <p>No matching items.</p> : null}</div>
    </section>
  </div>;
}

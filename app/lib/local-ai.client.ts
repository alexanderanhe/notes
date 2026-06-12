export type LocalAIAvailability =
  | "available"
  | "downloadable"
  | "downloading"
  | "unavailable";

export interface LocalAICapabilities {
  summarizer: LocalAIAvailability;
  translator: LocalAIAvailability;
  languageDetector: LocalAIAvailability;
  writer: LocalAIAvailability;
  rewriter: LocalAIAvailability;
  languageModel: LocalAIAvailability;
}

export interface LocalAIOptions {
  onStatus?: (status: LocalAIAvailability) => void;
}

export interface SummarizeOptions extends LocalAIOptions {
  type?: "key-points" | "tl;dr" | "teaser" | "headline";
  format?: "markdown" | "plain-text";
  length?: "short" | "medium" | "long";
}

export interface DetectedLanguage {
  detectedLanguage: string;
  confidence: number;
}

interface BuiltInAIFactory {
  availability?: (options?: Record<string, unknown>) => Promise<string>;
  capabilities?: (options?: Record<string, unknown>) => Promise<unknown>;
  create: (options?: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

declare global {
  interface Window {
    Summarizer?: BuiltInAIFactory;
    Translator?: BuiltInAIFactory;
    LanguageDetector?: BuiltInAIFactory;
    Writer?: BuiltInAIFactory;
    Rewriter?: BuiltInAIFactory;
    LanguageModel?: BuiltInAIFactory;
    ai?: {
      languageModel?: BuiltInAIFactory;
    };
  }
}

export class LocalAIUnavailableError extends Error {
  constructor(message = "This local AI feature is unavailable in this browser.") {
    super(message);
    this.name = "LocalAIUnavailableError";
  }
}

export async function getLocalAICapabilities(): Promise<LocalAICapabilities> {
  const entries = await Promise.all(
    (
      [
        ["summarizer", getFactory("Summarizer")],
        ["translator", getFactory("Translator")],
        ["languageDetector", getFactory("LanguageDetector")],
        ["writer", getFactory("Writer")],
        ["rewriter", getFactory("Rewriter")],
        ["languageModel", getLanguageModelFactory()],
      ] as const
    ).map(async ([name, factory]) => [
      name,
      await getAvailability(
        factory,
        name === "translator"
          ? { sourceLanguage: "en", targetLanguage: "es" }
          : undefined,
      ),
    ] as const),
  );
  return Object.fromEntries(entries) as unknown as LocalAICapabilities;
}

export async function canSummarize() {
  return isUsable(await getAvailability(getFactory("Summarizer")));
}

export async function canTranslate() {
  return isUsable(await getAvailability(getFactory("Translator")));
}

export async function canDetectLanguage() {
  return isUsable(await getAvailability(getFactory("LanguageDetector")));
}

export async function summarizeText(
  text: string,
  options: SummarizeOptions = {},
) {
  const session = await createSession("Summarizer", {
    type: options.type ?? "key-points",
    format: options.format ?? "markdown",
    length: options.length ?? "medium",
  }, options);
  return callTextMethod(session, "summarize", text);
}

export async function translateText(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
  options: LocalAIOptions = {},
) {
  const session = await createSession(
    "Translator",
    { sourceLanguage, targetLanguage },
    options,
  );
  return callTextMethod(session, "translate", text);
}

export async function detectLanguage(
  text: string,
  options: LocalAIOptions = {},
): Promise<DetectedLanguage[]> {
  const session = await createSession("LanguageDetector", {}, options);
  try {
    const detect = session.detect;
    if (typeof detect !== "function") throw new LocalAIUnavailableError();
    const result = await detect.call(session, text);
    return Array.isArray(result) ? result as DetectedLanguage[] : [];
  } finally {
    const destroy = session.destroy;
    if (typeof destroy === "function") destroy.call(session);
  }
}

export async function suggestTitle(text: string, options: LocalAIOptions = {}) {
  return generateText(
    `Suggest one concise title for the following private note. Return only the title.\n\n${text}`,
    options,
  );
}

export async function extractTasks(text: string, options: LocalAIOptions = {}) {
  return generateText(
    `Extract actionable tasks from the following private note. Return a Markdown checklist only. If there are no tasks, return "No actionable tasks found."\n\n${text}`,
    options,
  );
}

export async function rewriteText(
  text: string,
  instruction: string,
  options: LocalAIOptions = {},
) {
  const rewriter = getFactory("Rewriter");
  if (isUsable(await getAvailability(rewriter))) {
    const session = await createSession("Rewriter", { sharedContext: instruction }, options);
    return callTextMethod(session, "rewrite", text, { context: instruction });
  }
  return generateText(
    `Rewrite the text according to this instruction: ${instruction}\n\nReturn only the rewritten text.\n\n${text}`,
    options,
  );
}

async function generateText(prompt: string, options: LocalAIOptions) {
  const writer = getFactory("Writer");
  if (isUsable(await getAvailability(writer))) {
    const session = await createSession("Writer", {}, options);
    return callTextMethod(session, "write", prompt);
  }
  const session = await createLanguageModelSession(options);
  return callTextMethod(session, "prompt", prompt);
}

async function createLanguageModelSession(options: LocalAIOptions) {
  const factory = getLanguageModelFactory();
  return createFactorySession(factory, {}, options);
}

async function createSession(
  name: Exclude<keyof Window, "ai">,
  createOptions: Record<string, unknown>,
  options: LocalAIOptions,
) {
  return createFactorySession(getFactory(name), createOptions, options);
}

async function createFactorySession(
  factory: BuiltInAIFactory | undefined,
  createOptions: Record<string, unknown>,
  options: LocalAIOptions,
) {
  const availability = await getAvailability(factory, createOptions);
  options.onStatus?.(availability);
  if (!factory || !isUsable(availability)) throw new LocalAIUnavailableError();
  if (availability !== "available") options.onStatus?.("downloading");
  const session = await factory.create({
    ...createOptions,
    monitor(monitor: EventTarget) {
      monitor.addEventListener("downloadprogress", () => {
        options.onStatus?.("downloading");
      });
    },
  });
  options.onStatus?.("available");
  return session;
}

async function callTextMethod(
  session: Record<string, unknown>,
  method: string,
  text: string,
  options?: Record<string, unknown>,
) {
  try {
    const action = session[method];
    if (typeof action !== "function") throw new LocalAIUnavailableError();
    const result = await action.call(session, text, options);
    return String(result).trim();
  } finally {
    const destroy = session.destroy;
    if (typeof destroy === "function") destroy.call(session);
  }
}

function getFactory(name: Exclude<keyof Window, "ai">) {
  if (typeof window === "undefined") return undefined;
  const value = window[name];
  return isFactory(value) ? value : undefined;
}

function getLanguageModelFactory() {
  if (typeof window === "undefined") return undefined;
  return getFactory("LanguageModel") ?? window.ai?.languageModel;
}

async function getAvailability(
  factory: BuiltInAIFactory | undefined,
  options?: Record<string, unknown>,
): Promise<LocalAIAvailability> {
  if (!factory) return "unavailable";
  try {
    if (factory.availability) {
      return normalizeAvailability(await factory.availability(options));
    }
    if (factory.capabilities) {
      return normalizeAvailability(
        (await factory.capabilities(options) as { available?: string })?.available,
      );
    }
    return "available";
  } catch {
    return "unavailable";
  }
}

function normalizeAvailability(value: unknown): LocalAIAvailability {
  if (value === "available" || value === "readily") return "available";
  if (value === "downloading") return "downloading";
  if (value === "downloadable" || value === "after-download") return "downloadable";
  return "unavailable";
}

function isUsable(value: LocalAIAvailability) {
  return value !== "unavailable";
}

function isFactory(value: unknown): value is BuiltInAIFactory {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as BuiltInAIFactory).create === "function",
  );
}

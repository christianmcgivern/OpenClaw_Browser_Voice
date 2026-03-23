import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

type ProviderName = "openai" | "google";
type ConversationMode = "device_local" | "shared";

type TrustedBrowserRecord = {
  id: string;
  label?: string;
};

type ConversationRecord = {
  id: string;
  sessionKey: string;
  title: string;
  summary?: string;
  browserId: string;
  browserLabel?: string;
  ownerBrowserIds: string[];
  mode: ConversationMode;
  provider: ProviderName;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  preview: string;
  sessionFile?: string;
};

type BrowserConversationState = {
  lastConversationId?: string;
  recentConversationIds: string[];
};

type ConversationStore = {
  conversations: Record<string, ConversationRecord>;
  browserState: Record<string, BrowserConversationState>;
};

type StoreDeps = {
  agentId: string;
  sessionKeyBase: string;
  conversationStorePath: string;
  validateBodyString: (value: unknown, maxLength: number) => string;
  uniqueArray: (values: string[]) => string[];
  summarizeText: (text: string, maxLength?: number) => string;
  clipForLog: (value: string, max?: number) => string;
  browserVoiceLog: (event: string, details?: Record<string, unknown>) => void;
};

export type {
  ProviderName,
  ConversationMode,
  TrustedBrowserRecord,
  ConversationRecord,
  BrowserConversationState,
  ConversationStore,
};

export function loadConversationStore(storePath: string): ConversationStore {
  try {
    if (!fs.existsSync(storePath)) {
      return {
        conversations: {},
        browserState: {},
      };
    }
    const raw = JSON.parse(fs.readFileSync(storePath, "utf8"));
    return {
      conversations: raw && typeof raw === "object" && raw.conversations && typeof raw.conversations === "object"
        ? raw.conversations as Record<string, ConversationRecord>
        : {},
      browserState: raw && typeof raw === "object" && raw.browserState && typeof raw.browserState === "object"
        ? raw.browserState as Record<string, BrowserConversationState>
        : {},
    };
  } catch {
    return {
      conversations: {},
      browserState: {},
    };
  }
}

export function saveConversationStore(storePath: string, store: ConversationStore) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function resolveSessionStorePath(agentId: string) {
  return `/home/chris/.openclaw/agents/${agentId}/sessions/sessions.json`;
}

function ensureLocalSessionExists(params: {
  agentId: string;
  sessionKey: string;
}) {
  const storePath = resolveSessionStorePath(params.agentId);
  const sessionsDir = path.dirname(storePath);
  fs.mkdirSync(sessionsDir, { recursive: true });

  const store = fs.existsSync(storePath)
    ? JSON.parse(fs.readFileSync(storePath, "utf8")) as Record<string, any>
    : {};

  if (store[params.sessionKey]) {
    return store;
  }

  const sessionId = randomUUID();
  const sessionFile = path.join(sessionsDir, `${sessionId}.jsonl`);
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

  const header = {
    type: "session",
    version: 3,
    id: sessionId,
    timestamp: nowIso,
    cwd: "/home/chris/.openclaw/workspace",
  };

  fs.writeFileSync(sessionFile, `${JSON.stringify(header)}\n`, "utf8");
  store[params.sessionKey] = {
    sessionId,
    updatedAt: nowMs,
    systemSent: true,
    abortedLastRun: false,
    chatType: "direct",
    deliveryContext: {
      channel: "webchat",
    },
    lastChannel: "webchat",
    origin: {
      label: "Browser Voice Gateway",
      provider: "webchat",
      surface: "browser-voice",
      chatType: "direct",
    },
    sessionFile,
    compactionCount: 0,
    modelProvider: "openclaw",
    model: "browser-voice",
  };
  fs.writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  return store;
}

export function resolveConversationSessionKey(sessionKeyBase: string, conversationId: string) {
  return `${sessionKeyBase}:${conversationId}`;
}

function getOrCreateBrowserConversationState(store: ConversationStore, browserId: string, uniqueArray: StoreDeps["uniqueArray"]): BrowserConversationState {
  const existing = store.browserState[browserId];
  if (existing) {
    existing.recentConversationIds = Array.isArray(existing.recentConversationIds) ? uniqueArray(existing.recentConversationIds) : [];
    return existing;
  }
  const created: BrowserConversationState = {
    recentConversationIds: [],
  };
  store.browserState[browserId] = created;
  return created;
}

function touchBrowserConversation(store: ConversationStore, browserId: string, conversationId: string, uniqueArray: StoreDeps["uniqueArray"]) {
  const state = getOrCreateBrowserConversationState(store, browserId, uniqueArray);
  state.lastConversationId = conversationId;
  state.recentConversationIds = uniqueArray([conversationId, ...state.recentConversationIds]).slice(0, 24);
}

function createConversationRecord(params: {
  sessionKeyBase: string;
  browser: TrustedBrowserRecord;
  provider: ProviderName;
  mode: ConversationMode;
  title?: string;
}): ConversationRecord {
  const now = new Date().toISOString();
  const id = randomUUID();
  return {
    id,
    sessionKey: resolveConversationSessionKey(params.sessionKeyBase, id),
    title: params.title?.trim() || `${params.provider === "google" ? "Gemini" : "OpenAI"} conversation`,
    browserId: params.browser.id,
    browserLabel: params.browser.label,
    ownerBrowserIds: [params.browser.id],
    mode: params.mode,
    provider: params.provider,
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
    preview: "",
  };
}

export function ensureConversationRecord(params: {
  deps: StoreDeps;
  browser: TrustedBrowserRecord;
  provider: ProviderName;
  body: Record<string, unknown>;
}) {
  const store = loadConversationStore(params.deps.conversationStorePath);
  const requestedId = params.deps.validateBodyString(params.body.conversationId, 120);
  const preferLast = params.body.useLast !== false;
  let conversation: ConversationRecord | undefined;

  if (requestedId && store.conversations[requestedId]) {
    conversation = store.conversations[requestedId];
  } else if (preferLast) {
    const browserState = getOrCreateBrowserConversationState(store, params.browser.id, params.deps.uniqueArray);
    if (browserState.lastConversationId && store.conversations[browserState.lastConversationId]) {
      conversation = store.conversations[browserState.lastConversationId];
    }
  }

  const forceNew = params.body.forceNew === true;
  if (!conversation || forceNew) {
    const mode = params.body.mode === "shared" ? "shared" : "device_local";
    conversation = createConversationRecord({
      sessionKeyBase: params.deps.sessionKeyBase,
      browser: params.browser,
      provider: params.provider,
      mode,
      title: params.deps.validateBodyString(params.body.title, 120) || undefined,
    });
  }

  conversation.provider = params.provider;
  conversation.updatedAt = new Date().toISOString();
  conversation.browserLabel = params.browser.label;
  conversation.ownerBrowserIds = params.deps.uniqueArray([...conversation.ownerBrowserIds, params.browser.id]);
  if (!conversation.title?.trim()) {
    conversation.title = `${params.provider === "google" ? "Gemini" : "OpenAI"} conversation`;
  }
  store.conversations[conversation.id] = conversation;
  touchBrowserConversation(store, params.browser.id, conversation.id, params.deps.uniqueArray);
  saveConversationStore(params.deps.conversationStorePath, store);
  params.deps.browserVoiceLog("conversation_ensured", {
    conversationId: conversation.id,
    browserId: params.browser.id,
    provider: params.provider,
    mode: conversation.mode,
    forceNew: params.body.forceNew === true,
    requestedConversationId: requestedId || null,
  });
  return conversation;
}

export function updateConversationRecord(params: {
  deps: StoreDeps;
  conversationId: string;
  mutate: (conversation: ConversationRecord) => void;
}) {
  const store = loadConversationStore(params.deps.conversationStorePath);
  const conversation = store.conversations[params.conversationId];
  if (!conversation) {
    return null;
  }
  params.mutate(conversation);
  conversation.updatedAt = new Date().toISOString();
  store.conversations[conversation.id] = conversation;
  touchBrowserConversation(store, conversation.browserId, conversation.id, params.deps.uniqueArray);
  saveConversationStore(params.deps.conversationStorePath, store);
  params.deps.browserVoiceLog("conversation_updated", {
    conversationId: conversation.id,
    provider: conversation.provider,
    mode: conversation.mode,
    preview: params.deps.clipForLog(conversation.preview || ""),
    sessionFile: conversation.sessionFile ?? null,
  });
  return conversation;
}

export function browserCanAccessConversation(browserId: string, conversation: ConversationRecord) {
  return conversation.mode === "shared" || conversation.ownerBrowserIds.includes(browserId);
}

export function getBrowserConversation(storePath: string, browserId: string, conversationId: string) {
  const store = loadConversationStore(storePath);
  const conversation = store.conversations[conversationId];
  if (!conversation) {
    return null;
  }
  return browserCanAccessConversation(browserId, conversation) ? conversation : null;
}

export function readSessionTranscriptPreview(sessionFile?: string): string {
  if (!sessionFile || !fs.existsSync(sessionFile)) {
    return "";
  }
  const lines = fs.readFileSync(sessionFile, "utf8").trim().split("\n").filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]);
      const message = parsed?.message;
      if (!message || !Array.isArray(message.content)) {
        continue;
      }
      const textPart = message.content.find((part: any) => part && typeof part.text === "string" && part.text.trim());
      if (textPart?.text) {
        return String(textPart.text).trim();
      }
    } catch {
      // ignore malformed lines
    }
  }
  return "";
}

export function buildConversationList(store: ConversationStore, browserId: string, uniqueArray: StoreDeps["uniqueArray"]) {
  const currentBrowserState = getOrCreateBrowserConversationState(store, browserId, uniqueArray);
  const conversations = Object.values(store.conversations).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const currentDevice = conversations.filter((entry) => entry.ownerBrowserIds.includes(browserId) && entry.mode !== "shared");
  const shared = conversations.filter((entry) => entry.mode === "shared");
  const otherDevices = conversations.filter((entry) => !entry.ownerBrowserIds.includes(browserId) && entry.mode !== "shared");
  return {
    currentConversationId: currentBrowserState.lastConversationId ?? null,
    currentDevice,
    otherDevices,
    shared,
  };
}

export function serializeConversation(conversation: ConversationRecord) {
  return {
    id: conversation.id,
    title: conversation.title,
    summary: conversation.summary || "",
    mode: conversation.mode,
    provider: conversation.provider,
    browserLabel: conversation.browserLabel ?? null,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    lastMessageAt: conversation.lastMessageAt,
    preview: conversation.preview,
  };
}

export function serializeConversationList(payload: ReturnType<typeof buildConversationList>) {
  return {
    currentConversationId: payload.currentConversationId,
    currentDevice: payload.currentDevice.map(serializeConversation),
    otherDevices: payload.otherDevices.map(serializeConversation),
    shared: payload.shared.map(serializeConversation),
  };
}

export function searchConversations(store: ConversationStore, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [];
  }
  return Object.values(store.conversations)
    .map((conversation) => {
      const haystacks = [conversation.title, conversation.preview];
      if (conversation.sessionFile && fs.existsSync(conversation.sessionFile)) {
        try {
          haystacks.push(fs.readFileSync(conversation.sessionFile, "utf8").slice(-4000));
        } catch {
          // ignore read failures
        }
      }
      const score = haystacks.reduce((acc, value) => acc + (value.toLowerCase().includes(needle) ? 1 : 0), 0);
      return { conversation, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || Date.parse(b.conversation.updatedAt) - Date.parse(a.conversation.updatedAt))
    .map((entry) => entry.conversation)
    .slice(0, 20);
}

export function appendMessageToSessionTranscriptLocal(params: {
  agentId: string;
  sessionKey: string;
  role: "user" | "assistant";
  text?: string;
  idempotencyKey?: string;
}) {
  const sessionKey = params.sessionKey.trim();
  const text = params.text?.trim();
  if (!sessionKey) {
    return { ok: false as const, reason: "missing sessionKey" };
  }
  if (!text) {
    return { ok: false as const, reason: "empty text" };
  }

  try {
    const storePath = resolveSessionStorePath(params.agentId);
    const store = ensureLocalSessionExists({
      agentId: params.agentId,
      sessionKey,
    });
    const entry = store[sessionKey];
    const sessionFile = typeof entry?.sessionFile === "string" && entry.sessionFile.trim()
      ? entry.sessionFile.trim()
      : typeof entry?.sessionId === "string" && entry.sessionId.trim()
        ? path.join(path.dirname(storePath), `${entry.sessionId.trim()}.jsonl`)
        : "";
    if (!sessionFile) {
      return { ok: false as const, reason: `unknown sessionKey: ${sessionKey}` };
    }

    let parentId: string | undefined;
    if (fs.existsSync(sessionFile)) {
      const lines = fs.readFileSync(sessionFile, "utf8").trim().split("\n").filter(Boolean);
      if (params.idempotencyKey) {
        const duplicate = lines.some((line) => line.includes(`"idempotencyKey":"${params.idempotencyKey}"`));
        if (duplicate) {
          return { ok: true as const, sessionFile };
        }
      }
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        try {
          const parsed = JSON.parse(lines[index]);
          if (typeof parsed?.id === "string" && parsed.id.trim()) {
            parentId = parsed.id.trim();
            break;
          }
        } catch {
          // ignore malformed historical lines
        }
      }
    }

    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    const line = {
      type: "message",
      id: randomUUID().slice(0, 8),
      ...(parentId ? { parentId } : {}),
      timestamp: nowIso,
      message: {
        role: params.role,
        content: [{
          type: "text",
          text,
          ...(params.role === "assistant" ? { textSignature: `msg_${randomUUID().replace(/-/g, "")}` } : {}),
        }],
        ...(params.role === "assistant"
          ? {
              api: "openai-responses",
              provider: "openclaw",
              model: "browser-voice-mirror",
              usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: {
                  input: 0,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  total: 0,
                },
              },
              stopReason: "stop",
            }
          : {}),
        timestamp: nowMs,
        ...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}),
      },
    };

    fs.appendFileSync(sessionFile, `${JSON.stringify(line)}\n`, "utf8");
    entry.updatedAt = nowMs;
    fs.writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    return { ok: true as const, sessionFile };
  } catch (err) {
    return { ok: false as const, reason: err instanceof Error ? err.message : String(err) };
  }
}

export function persistConversationTranscript(params: {
  deps: StoreDeps;
  conversationId: string;
  role: "user" | "assistant";
  text: string;
  entryId: string;
}) {
  const store = loadConversationStore(params.deps.conversationStorePath);
  const conversation = store.conversations[params.conversationId];
  if (!conversation) {
    throw new Error("unknown conversationId");
  }
  const result = appendMessageToSessionTranscriptLocal({
    agentId: params.deps.agentId,
    sessionKey: conversation.sessionKey,
    role: params.role,
    text: params.text,
    idempotencyKey: `browser-voice:${params.conversationId}:${params.entryId}`,
  });
  if (!result.ok) {
    throw new Error(result.reason);
  }
  updateConversationRecord({
    deps: params.deps,
    conversationId: params.conversationId,
    mutate(entry) {
      entry.sessionFile = result.sessionFile;
      entry.preview = params.deps.summarizeText(params.text);
      if (!entry.title || entry.title === `${entry.provider === "google" ? "Gemini" : "OpenAI"} conversation`) {
        entry.title = params.deps.summarizeText(params.text, 48) || entry.title;
      }
      entry.lastMessageAt = new Date().toISOString();
    },
  });
}

export function readConversationThread(conversation: ConversationRecord, maxMessages = 80) {
  const sessionFile = typeof conversation.sessionFile === "string" && conversation.sessionFile.trim()
    ? conversation.sessionFile.trim()
    : "";
  if (!sessionFile || !fs.existsSync(sessionFile)) {
    return [] as Array<{ id: string; role: "user" | "assistant"; text: string; timestamp: string; synthetic: boolean }>;
  }

  const out: Array<{ id: string; role: "user" | "assistant"; text: string; timestamp: string; synthetic: boolean }> = [];
  const lines = fs.readFileSync(sessionFile, "utf8").split("\n").filter(Boolean);
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Record<string, any>;
      if (parsed.type !== "message") {
        continue;
      }
      const message = parsed.message && typeof parsed.message === "object" ? parsed.message as Record<string, any> : null;
      const role = message?.role === "user" ? "user" : message?.role === "assistant" ? "assistant" : null;
      const content = Array.isArray(message?.content) ? message.content : [];
      const text = content
        .map((entry) => (entry && typeof entry === "object" && typeof entry.text === "string" ? entry.text.trim() : ""))
        .filter(Boolean)
        .join("\n")
        .trim();
      if (!role || !text) {
        continue;
      }
      const idempotencyKey = typeof message?.idempotencyKey === "string" ? message.idempotencyKey : "";
      const synthetic = idempotencyKey.startsWith("browser-voice-open:") || idempotencyKey.startsWith("browser-voice-close:");
      out.push({
        id: typeof parsed.id === "string" ? parsed.id : randomUUID().slice(0, 8),
        role,
        text,
        timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : new Date().toISOString(),
        synthetic,
      });
    } catch {
      // ignore malformed historical lines
    }
  }
  return out.slice(-Math.max(1, maxMessages));
}

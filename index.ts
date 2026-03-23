import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { exec as execCallback, execFileSync } from "node:child_process";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import {
  createOpenAiClientSecret as createOpenAiClientSecretProvider,
  runOpenAiTextTurn as runOpenAiTextTurnProvider,
  summarizeOpenAiConversation as summarizeOpenAiConversationProvider,
  synthesizeOpenAiSpeech as synthesizeOpenAiSpeechProvider,
  transcribeOpenAiAudio as transcribeOpenAiAudioProvider,
} from "./providers/openai-provider.ts";
import { createGeminiEphemeralToken } from "./providers/gemini-provider.ts";
import { createGeminiLiveBridge } from "./providers/gemini-live-bridge.ts";
import { buildStaticRoutes, type RouteDefinition } from "./routes/static-routes.ts";
import { buildChatRoutes } from "./routes/chat-routes.ts";
import { buildDiagnosticRoutes } from "./routes/diagnostic-routes.ts";
import { buildProviderRoutes } from "./routes/provider-routes.ts";
import { buildConversationRoutes } from "./routes/conversation-routes.ts";
import { buildSessionRoutes } from "./routes/session-routes.ts";
import {
  appendMessageToSessionTranscriptLocal as appendMessageToSessionTranscriptLocalStore,
  browserCanAccessConversation as browserCanAccessConversationStore,
  buildConversationList as buildConversationListStore,
  ensureConversationRecord as ensureConversationRecordStore,
  getBrowserConversation as getBrowserConversationStore,
  loadConversationStore as loadConversationStoreFile,
  persistConversationTranscript as persistConversationTranscriptStore,
  readConversationThread as readConversationThreadStore,
  readSessionTranscriptPreview as readSessionTranscriptPreviewStore,
  saveConversationStore as saveConversationStoreFile,
  searchConversations as searchConversationsStore,
  serializeConversation as serializeConversationStore,
  serializeConversationList as serializeConversationListStore,
  updateConversationRecord as updateConversationRecordStore,
} from "./store/conversation-store.ts";

const execAsync = promisify(execCallback);

type ProviderName = "openai" | "google";
type ConversationMode = "device_local" | "shared";

type BrowserVoiceConfig = {
  enabled: boolean;
  routeBase: string;
  browserAccessCode: string;
  browserSessionTtlHours: number;
  defaultProvider: ProviderName;
  openaiModel: string;
  openaiVoice: string;
  geminiModel: string;
  sessionKey: string;
  serve: {
    enabled: boolean;
    bind: string;
    port: number;
    publicHost?: string;
    certPath: string;
    keyPath: string;
    autoSelfSigned: boolean;
  };
};

type PluginApi = {
  config: unknown;
  pluginConfig: unknown;
  logger: {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
  };
  runtime?: {
    modelAuth?: {
      resolveApiKeyForProvider?: (params: { provider: string; cfg?: unknown }) => Promise<unknown>;
    };
  };
  registerHttpRoute?: (route: {
    path: string;
    auth?: string;
    handler: (req: any, res: any) => void | Promise<void>;
  }) => void;
  registerGatewayMethod?: (method: string, handler: (opts: any) => void | Promise<void>) => void;
};

type TrustedBrowserRecord = {
  id: string;
  label?: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  lastProvider?: ProviderName;
};

type TrustedBrowserStore = {
  sessions: Record<string, TrustedBrowserRecord>;
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

type ToolPolicy = {
  profile: string;
  deny: string[];
};

const PLUGIN_ID = "browser-voice-gateway";
const PLUGIN_NAME = "Browser Voice Gateway";
const PLUGIN_ROOT = "/home/chris/.openclaw/plugins/browser-voice-gateway";
const UI_ROOT = path.join(PLUGIN_ROOT, "ui");
const TRUST_STORE_PATH = "/home/chris/.openclaw/browser-voice/trusted-browsers.json";
const CONVERSATION_STORE_PATH = "/home/chris/.openclaw/browser-voice/conversations.json";
const TLS_DIR = "/home/chris/.openclaw/browser-voice/tls";
const BROWSER_VOICE_LOG_PATH = "/home/chris/.openclaw/logs/browser-voice-gateway.log";
const AGENT_ID = "main";
const COOKIE_NAME = "openclaw_browser_voice";
const loginFailures = new Map<string, { count: number; blockedUntilMs: number }>();
const OPENCLAW_TOOL_NAME = "openclaw_tool";
const WRITE_FILE_TOOL_NAME = "write_file";
const OPENCLAW_TOOL_DESCRIPTION =
  "Invoke an OpenClaw tool available to this browser conversation. Provide the OpenClaw tool id in `tool` and the tool arguments object in `args`.";
const WRITE_FILE_TOOL_DESCRIPTION =
  "Create or overwrite a file. Always provide an absolute path and the file content, even if the content is blank.";
const OPENCLAW_TOOL_LIST = [
  "apply_patch",
  "background_exec",
  "exec",
  "pdf",
  "process",
  "read",
  "web",
  "weather",
  "sports",
  "finance",
  "time",
  "write",
];

function ensureBrowserVoiceLogDir() {
  fs.mkdirSync(path.dirname(BROWSER_VOICE_LOG_PATH), { recursive: true });
}

function clipForLog(value: string, max = 280) {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}...(${value.length} chars)`;
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch (err) {
    return JSON.stringify({ stringifyError: err instanceof Error ? err.message : String(err) });
  }
}

function browserVoiceLog(event: string, details: Record<string, unknown> = {}) {
  try {
    ensureBrowserVoiceLogDir();
    const line = {
      ts: new Date().toISOString(),
      event,
      ...details,
    };
    fs.appendFileSync(BROWSER_VOICE_LOG_PATH, `${safeJson(line)}\n`, "utf8");
  } catch {
    // avoid crashing the plugin on logging failures
  }
}

function resolveConfig(raw: unknown): BrowserVoiceConfig {
  const cfg = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};

  const routeBaseRaw = typeof cfg.routeBase === "string" ? cfg.routeBase.trim() : "";
  const routeBase = routeBaseRaw ? `/${routeBaseRaw.replace(/^\/+|\/+$/g, "")}` : "/browser-voice";

  return {
    enabled: typeof cfg.enabled === "boolean" ? cfg.enabled : true,
    routeBase,
    browserAccessCode:
      typeof cfg.browserAccessCode === "string" && cfg.browserAccessCode.trim()
        ? cfg.browserAccessCode.trim()
        : "change-me-browser-voice",
    browserSessionTtlHours:
      typeof cfg.browserSessionTtlHours === "number" && Number.isFinite(cfg.browserSessionTtlHours)
        ? Math.min(24 * 365, Math.max(1, Math.round(cfg.browserSessionTtlHours)))
        : 24 * 30,
    defaultProvider: cfg.defaultProvider === "google" ? "google" : "openai",
    openaiModel:
      typeof cfg.openaiModel === "string" && cfg.openaiModel.trim()
        ? cfg.openaiModel.trim()
        : "gpt-4o-realtime-preview",
    openaiVoice:
      typeof cfg.openaiVoice === "string" && cfg.openaiVoice.trim()
        ? cfg.openaiVoice.trim()
        : "alloy",
    geminiModel:
      typeof cfg.geminiModel === "string" && cfg.geminiModel.trim()
        ? cfg.geminiModel.trim()
        : "gemini-2.5-flash-native-audio-preview-12-2025",
    sessionKey:
      typeof cfg.sessionKey === "string" && cfg.sessionKey.trim()
        ? cfg.sessionKey.trim()
        : "agent:main:browser-voice",
    serve: {
      enabled: typeof (cfg.serve as Record<string, unknown> | undefined)?.enabled === "boolean"
        ? Boolean((cfg.serve as Record<string, unknown>).enabled)
        : true,
      bind:
        typeof (cfg.serve as Record<string, unknown> | undefined)?.bind === "string" &&
        String((cfg.serve as Record<string, unknown>).bind).trim()
          ? String((cfg.serve as Record<string, unknown>).bind).trim()
          : "0.0.0.0",
      port:
        typeof (cfg.serve as Record<string, unknown> | undefined)?.port === "number"
          ? Number((cfg.serve as Record<string, unknown>).port)
          : 19443,
      publicHost:
        typeof (cfg.serve as Record<string, unknown> | undefined)?.publicHost === "string" &&
        String((cfg.serve as Record<string, unknown>).publicHost).trim()
          ? String((cfg.serve as Record<string, unknown>).publicHost).trim()
          : undefined,
      certPath:
        typeof (cfg.serve as Record<string, unknown> | undefined)?.certPath === "string" &&
        String((cfg.serve as Record<string, unknown>).certPath).trim()
          ? String((cfg.serve as Record<string, unknown>).certPath).trim()
          : path.join(TLS_DIR, "browser-voice-cert.pem"),
      keyPath:
        typeof (cfg.serve as Record<string, unknown> | undefined)?.keyPath === "string" &&
        String((cfg.serve as Record<string, unknown>).keyPath).trim()
          ? String((cfg.serve as Record<string, unknown>).keyPath).trim()
          : path.join(TLS_DIR, "browser-voice-key.pem"),
      autoSelfSigned: typeof (cfg.serve as Record<string, unknown> | undefined)?.autoSelfSigned === "boolean"
        ? Boolean((cfg.serve as Record<string, unknown>).autoSelfSigned)
        : true,
    },
  };
}

function ensureEnabled(config: BrowserVoiceConfig) {
  if (!config.enabled) {
    throw new Error(`${PLUGIN_ID} is disabled`);
  }
}

function ensureTrustStoreDir() {
  fs.mkdirSync(path.dirname(TRUST_STORE_PATH), { recursive: true });
}

function loadTrustStore(): TrustedBrowserStore {
  ensureTrustStoreDir();
  if (!fs.existsSync(TRUST_STORE_PATH)) {
    return { sessions: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(TRUST_STORE_PATH, "utf8")) as TrustedBrowserStore;
    if (parsed && typeof parsed === "object" && parsed.sessions && typeof parsed.sessions === "object") {
      return parsed;
    }
  } catch {
    // fall through
  }
  return { sessions: {} };
}

function saveTrustStore(store: TrustedBrowserStore) {
  ensureTrustStoreDir();
  fs.writeFileSync(TRUST_STORE_PATH, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function loadConversationStore(): ConversationStore {
  return loadConversationStoreFile(CONVERSATION_STORE_PATH) as ConversationStore;
}

function saveConversationStore(store: ConversationStore) {
  saveConversationStoreFile(CONVERSATION_STORE_PATH, store as any);
}

function ensureTlsDir() {
  fs.mkdirSync(TLS_DIR, { recursive: true });
}

function getCookie(req: any, name: string): string | undefined {
  const cookieHeader = typeof req?.headers?.cookie === "string" ? req.headers.cookie : "";
  if (!cookieHeader) {
    return undefined;
  }
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return undefined;
}

function isSecureRequest(req: any): boolean {
  if (req?.socket?.encrypted) {
    return true;
  }
  const forwardedProto = typeof req?.headers?.["x-forwarded-proto"] === "string"
    ? req.headers["x-forwarded-proto"]
    : "";
  return forwardedProto.split(",").some((value: string) => value.trim().toLowerCase() === "https");
}

function setCookie(req: any, res: any, name: string, value: string, maxAgeSec: number) {
  const secure = isSecureRequest(req) ? "; Secure" : "";
  const cookie = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict${secure}; Max-Age=${maxAgeSec}`;
  res.setHeader("Set-Cookie", cookie);
}

function clearCookie(req: any, res: any, name: string) {
  const secure = isSecureRequest(req) ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${name}=; Path=/; HttpOnly; SameSite=Strict${secure}; Max-Age=0`);
}

function sendJson(res: any, statusCode: number, payload: unknown) {
  applySecurityHeaders(res);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function sendText(res: any, statusCode: number, text: string, contentType: string) {
  applySecurityHeaders(res);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", contentType);
  if (contentType.startsWith("text/html")) {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; connect-src 'self' https://api.openai.com; media-src 'self' blob:; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
  }
  res.end(text);
}

function applySecurityHeaders(res: any) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "microphone=(self), camera=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
}

function withCors(req: any, res: any, config: BrowserVoiceConfig) {
  const origin = typeof req?.headers?.origin === "string" ? req.headers.origin.trim() : "";
  if (!origin) {
    return;
  }
  try {
    const parsed = new URL(origin);
    const publicHost = resolvePublicHost(config);
    const allowedHosts = new Set<string>(["127.0.0.1", "localhost", publicHost]);
    if (allowedHosts.has(parsed.hostname)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    }
  } catch {
    // ignore malformed origin
  }
}

function readUiAsset(relPath: string): string {
  return fs.readFileSync(path.join(UI_ROOT, relPath), "utf8");
}

function readPluginLogTail(maxLines = 200) {
  if (!fs.existsSync(BROWSER_VOICE_LOG_PATH)) {
    return "";
  }
  const lines = fs.readFileSync(BROWSER_VOICE_LOG_PATH, "utf8").split("\n").filter(Boolean);
  return `${lines.slice(-Math.max(1, maxLines)).join("\n")}\n`;
}

function sanitizeLogValue(value: string) {
  return value
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted-secret]")
    .replace(/ek_[A-Za-z0-9_-]+/g, "[redacted-client-secret]")
    .replace(/AIza[0-9A-Za-z\-_]+/g, "[redacted-google-key]")
    .replace(/voice-browser-[A-Za-z0-9_-]+/g, "[redacted-access-code]");
}

function readSanitizedToolTrace(maxLines = 200) {
  if (!fs.existsSync(BROWSER_VOICE_LOG_PATH)) {
    return [];
  }
  const allowedEvents = new Set([
    "tool_trace_route_begin",
    "tool_trace_route_rejected",
    "tool_trace_route_denied",
    "tool_trace_route_missing_conversation",
    "tool_trace_route_wrong_browser",
    "tool_trace_route_result",
    "tool_invoke_begin",
    "tool_invoke_http_ok",
    "tool_invoke_http_error",
    "tool_invoke_http_parse_error",
    "tool_invoke_http_request_error",
    "tool_invoke_local_fallback_begin",
    "tool_invoke_local_fallback_done",
    "client_trace",
  ]);

  const lines = fs.readFileSync(BROWSER_VOICE_LOG_PATH, "utf8").split("\n").filter(Boolean);
  return lines
    .slice(-Math.max(1, maxLines * 4))
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is Record<string, unknown> => !!entry && allowedEvents.has(String(entry.event || "")))
    .map((entry) => {
      const out: Record<string, unknown> = {
        ts: entry.ts,
        event: entry.event,
      };
      if (typeof entry.tool === "string") out.tool = entry.tool;
      if (typeof entry.conversationId === "string") out.conversationId = entry.conversationId;
      if (typeof entry.ok === "boolean") out.ok = entry.ok;
      if (typeof entry.statusCode === "number") out.statusCode = entry.statusCode;
      if (typeof entry.reason === "string") out.reason = sanitizeLogValue(entry.reason);
      if (typeof entry.message === "string") out.message = sanitizeLogValue(entry.message);
      if (typeof entry.level === "string") out.level = entry.level;
      if (typeof entry.textPreview === "string") out.textPreview = sanitizeLogValue(entry.textPreview);
      if (typeof entry.requestedSessionKey === "string") out.requestedSessionKey = entry.requestedSessionKey;
      if (typeof entry.toolSessionKey === "string") out.toolSessionKey = entry.toolSessionKey;
      if (typeof entry.browserId === "string") out.browserId = entry.browserId;
      if (typeof entry.dataPreview === "string" && String(entry.event) === "client_trace") {
        out.dataPreview = sanitizeLogValue(entry.dataPreview);
      }
      return out;
    })
    .slice(-Math.max(1, maxLines));
}

function readSanitizedSessionTrace(maxLines = 200) {
  if (!fs.existsSync(BROWSER_VOICE_LOG_PATH)) {
    return [];
  }
  const allowedEvents = new Set([
    "client_trace",
    "openai_bootstrap_response",
    "gemini_bootstrap_response",
    "conversation_ensured",
    "conversation_updated",
    "trusted_browser_resolved",
  ]);

  const lines = fs.readFileSync(BROWSER_VOICE_LOG_PATH, "utf8").split("\n").filter(Boolean);
  return lines
    .slice(-Math.max(1, maxLines * 6))
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is Record<string, unknown> => !!entry && allowedEvents.has(String(entry.event || "")))
    .map((entry) => {
      const out: Record<string, unknown> = {
        ts: entry.ts,
        event: entry.event,
      };
      if (typeof entry.level === "string") out.level = entry.level;
      if (typeof entry.message === "string") out.message = sanitizeLogValue(entry.message);
      if (typeof entry.provider === "string") out.provider = entry.provider;
      if (typeof entry.mode === "string") out.mode = entry.mode;
      if (typeof entry.browserId === "string") out.browserId = entry.browserId;
      if (typeof entry.conversationId === "string") out.conversationId = entry.conversationId;
      if (typeof entry.preview === "string") out.preview = sanitizeLogValue(entry.preview);
      if (typeof entry.dataPreview === "string") out.dataPreview = sanitizeLogValue(entry.dataPreview);
      if (typeof entry.responsePreview === "string") out.responsePreview = sanitizeLogValue(entry.responsePreview);
      return out;
    })
    .slice(-Math.max(1, maxLines));
}

function getRemoteAddress(req: any): string {
  const forwardedFor = typeof req?.headers?.["x-forwarded-for"] === "string" ? req.headers["x-forwarded-for"] : "";
  const firstForwarded = forwardedFor.split(",")[0]?.trim();
  return firstForwarded || req?.socket?.remoteAddress || "unknown";
}

function validateBodyString(value: unknown, maxLen: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLen) : "";
}

function summarizeText(text: string, maxLen = 140): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > maxLen ? `${compact.slice(0, maxLen - 1)}…` : compact;
}

function uniqueArray(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function requireAllowedOrigin(req: any, config: BrowserVoiceConfig) {
  const origin = typeof req?.headers?.origin === "string" ? req.headers.origin.trim() : "";
  if (!origin) {
    return;
  }
  const parsed = new URL(origin);
  const publicHost = resolvePublicHost(config);
  const allowedHosts = new Set<string>(["127.0.0.1", "localhost", publicHost]);
  if (!allowedHosts.has(parsed.hostname)) {
    throw new Error("origin not allowed");
  }
}

function registerLoginFailure(req: any) {
  const key = getRemoteAddress(req);
  const entry = loginFailures.get(key) ?? { count: 0, blockedUntilMs: 0 };
  entry.count += 1;
  if (entry.count >= 5) {
    entry.blockedUntilMs = Date.now() + 10 * 60 * 1000;
  }
  loginFailures.set(key, entry);
}

function clearLoginFailure(req: any) {
  loginFailures.delete(getRemoteAddress(req));
}

function enforceLoginThrottle(req: any) {
  const key = getRemoteAddress(req);
  const entry = loginFailures.get(key);
  if (!entry) {
    return;
  }
  if (entry.blockedUntilMs > Date.now()) {
    throw new Error("too many failed login attempts; try again later");
  }
  if (entry.blockedUntilMs && entry.blockedUntilMs <= Date.now()) {
    loginFailures.delete(key);
  }
}

async function readJsonBody(req: any): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk: Buffer | string) => {
      raw += chunk.toString();
      if (raw.length > 256 * 1024) {
        reject(new Error("request body too large"));
      }
    });
    req.on("end", () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        resolve(parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

async function resolveProviderApiKey(api: PluginApi, provider: ProviderName): Promise<string> {
  const resolved = await api.runtime?.modelAuth?.resolveApiKeyForProvider?.({
    provider,
    cfg: api.config,
  });

  if (
    !resolved ||
    typeof resolved !== "object" ||
    !("apiKey" in resolved) ||
    typeof (resolved as { apiKey?: string }).apiKey !== "string" ||
    !(resolved as { apiKey?: string }).apiKey?.trim()
  ) {
    throw new Error(`missing ${provider} API key in OpenClaw auth`);
  }

  return (resolved as { apiKey: string }).apiKey.trim();
}

function resolveToolPolicy(api: PluginApi): ToolPolicy {
  const cfg = api.config && typeof api.config === "object" && !Array.isArray(api.config)
    ? (api.config as Record<string, unknown>)
    : {};
  const tools = cfg.tools && typeof cfg.tools === "object" && !Array.isArray(cfg.tools)
    ? (cfg.tools as Record<string, unknown>)
    : {};
  const profile = typeof tools.profile === "string" && tools.profile.trim() ? tools.profile.trim() : "default";
  const deny = Array.isArray(tools.deny)
    ? tools.deny.map((value) => (typeof value === "string" ? value.trim() : "")).filter(Boolean)
    : [];
  return { profile, deny };
}

function buildToolUsageSummary(api: PluginApi) {
  const policy = resolveToolPolicy(api);
  const available = OPENCLAW_TOOL_LIST.filter((tool) => !policy.deny.includes(tool));
  return {
    policy,
    available,
    functionName: OPENCLAW_TOOL_NAME,
    description: OPENCLAW_TOOL_DESCRIPTION,
    helperFunctions: [WRITE_FILE_TOOL_NAME],
  };
}

function buildOpenAiToolDefinition() {
  return [
    {
    type: "function",
    name: OPENCLAW_TOOL_NAME,
    description: OPENCLAW_TOOL_DESCRIPTION,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        tool: {
          type: "string",
          description: "OpenClaw tool id to invoke, such as exec, read, write, web, weather, sports, finance, time, process, or apply_patch.",
        },
        args: {
          type: "object",
          description: "Arguments object passed directly to the selected OpenClaw tool. For file operations, prefer absolute paths such as /home/chris/Desktop/test.txt.",
          additionalProperties: true,
        },
      },
      required: ["tool"],
    },
    },
    {
      type: "function",
      name: WRITE_FILE_TOOL_NAME,
      description: WRITE_FILE_TOOL_DESCRIPTION,
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: {
            type: "string",
            description: "Absolute destination path, for example /home/chris/Desktop/test.txt",
          },
          content: {
            type: "string",
            description: "File content. Use an empty string for a blank document.",
          },
        },
        required: ["path", "content"],
      },
    },
  ];
}

function buildGeminiToolDefinition() {
  return {
    functionDeclarations: [
      {
        name: OPENCLAW_TOOL_NAME,
        description: OPENCLAW_TOOL_DESCRIPTION,
        parameters: {
          type: "object",
          properties: {
            tool: {
              type: "string",
              description: "OpenClaw tool id to invoke, such as exec, read, write, web, weather, sports, finance, time, process, or apply_patch.",
            },
            args: {
              type: "object",
              description: "Arguments object passed directly to the selected OpenClaw tool. For file operations, prefer absolute paths such as /home/chris/Desktop/test.txt.",
              properties: {},
            },
          },
          required: ["tool"],
        },
      },
      {
        name: WRITE_FILE_TOOL_NAME,
        description: WRITE_FILE_TOOL_DESCRIPTION,
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Absolute destination path, for example /home/chris/Desktop/test.txt",
            },
            content: {
              type: "string",
              description: "File content. Use an empty string for a blank document.",
            },
          },
          required: ["path", "content"],
        },
      },
    ],
  };
}

function extractToolResultText(result: unknown): string {
  if (Array.isArray(result)) {
    const text = result
      .map((entry) => (entry && typeof entry === "object" && "text" in entry && typeof (entry as { text?: string }).text === "string"
        ? (entry as { text: string }).text
        : ""))
      .join("\n")
      .trim();
    if (text) {
      return text;
    }
  }
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const record = result as Record<string, unknown>;
    const content = Array.isArray(record.content) ? record.content : [];
    const text = content
      .map((entry) => (entry && typeof entry === "object" && "text" in entry && typeof (entry as { text?: string }).text === "string"
        ? (entry as { text: string }).text
        : ""))
      .join("\n")
      .trim();
    if (text) {
      return text;
    }
    if (typeof record.text === "string" && record.text.trim()) {
      return record.text.trim();
    }
  }
  if (typeof result === "string" && result.trim()) {
    return result.trim();
  }
  return "";
}

function buildToolInstructions(api: PluginApi) {
  const manifest = buildToolUsageSummary(api);
  return [
    "Tool use is available through the OpenClaw tool bridge.",
    `Use the ${OPENCLAW_TOOL_NAME} function when you need to run a general OpenClaw tool.`,
    `Use ${WRITE_FILE_TOOL_NAME} when the user asks to create or overwrite a file and the destination/content are already known.`,
    `Pass the OpenClaw tool id in \`tool\` and the arguments object in \`args\`.`,
    "When calling file tools such as read, write, or edit, include absolute paths whenever the destination is known.",
    "For this machine, prefer explicit paths like /home/chris/Desktop/<name> or /home/chris/.openclaw/workspace/<name> instead of vague relative paths.",
    "For write, always include both `path` and `content`, even when the content should be blank.",
    `This browser session uses OpenClaw tools profile \`${manifest.policy.profile}\`.`,
    manifest.available.length
      ? `Common allowed tools in this session: ${manifest.available.join(", ")}.`
      : "No common tools are currently exposed in the browser manifest.",
    manifest.policy.deny.length
      ? `Denied in this browser session: ${manifest.policy.deny.join(", ")}.`
      : "",
    "Do not ask for sessions_spawn, sessions_send, or agent-listing behavior from the browser tool bridge.",
  ].filter(Boolean).join(" ");
}

function resolveWorkspaceDir(api: PluginApi) {
  const cfg = api.config && typeof api.config === "object" && !Array.isArray(api.config)
    ? (api.config as Record<string, unknown>)
    : {};
  const agents = cfg.agents && typeof cfg.agents === "object" && !Array.isArray(cfg.agents)
    ? (cfg.agents as Record<string, unknown>)
    : {};
  const defaults = agents.defaults && typeof agents.defaults === "object" && !Array.isArray(agents.defaults)
    ? (agents.defaults as Record<string, unknown>)
    : {};
  const workspace = typeof defaults.workspace === "string" && defaults.workspace.trim()
    ? defaults.workspace.trim()
    : "";
  return workspace || "/home/chris/.openclaw/workspace";
}

function resolveToolPath(api: PluginApi, rawPath: unknown) {
  const trimmed = typeof rawPath === "string" ? rawPath.trim() : "";
  if (!trimmed) {
    throw new Error("Missing required parameter: path");
  }
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(resolveWorkspaceDir(api), trimmed);
}

function normalizeBrowserToolCall(tool: string, args: Record<string, unknown>) {
  if (tool === WRITE_FILE_TOOL_NAME) {
    const pathValue = typeof args.path === "string" ? args.path.trim() : "";
    const content = typeof args.content === "string" ? args.content : "";
    return {
      tool: "write",
      args: {
        path: pathValue,
        content,
      },
    };
  }
  if (tool === "exec") {
    const command = typeof args.command === "string" && args.command.trim()
      ? args.command.trim()
      : typeof args.cmd === "string" && args.cmd.trim()
        ? args.cmd.trim()
        : "";
    const timeout = typeof args.timeout === "number" && Number.isFinite(args.timeout) ? args.timeout : undefined;
    return {
      tool: "exec",
      args: {
        command,
        ...(timeout ? { timeout } : {}),
      },
    };
  }
  return { tool, args };
}

async function invokeOpenClawToolLocally(params: {
  api: PluginApi;
  tool: string;
  args: Record<string, unknown>;
}) {
  const normalized = normalizeBrowserToolCall(params.tool, params.args);
  try {
    if (normalized.tool === "exec") {
      const command = typeof normalized.args.command === "string" ? normalized.args.command.trim() : "";
      if (!command) {
        return { ok: false, text: "Tool error: Missing required parameter: command" };
      }
      const timeout = typeof normalized.args.timeout === "number" && Number.isFinite(normalized.args.timeout)
        ? normalized.args.timeout
        : 20000;
      const { stdout, stderr } = await execAsync(command, {
        cwd: resolveWorkspaceDir(params.api),
        timeout,
        maxBuffer: 1024 * 1024,
      });
      return { ok: true, text: [stdout, stderr].filter(Boolean).join("").trim() || "(no output)" };
    }

    if (normalized.tool === "read") {
      const targetPath = resolveToolPath(params.api, normalized.args.path);
      const raw = await fs.promises.readFile(targetPath, "utf8");
      const lines = raw.split(/\r?\n/);
      const offset = typeof normalized.args.offset === "number" && Number.isFinite(normalized.args.offset)
        ? Math.max(0, Math.trunc(normalized.args.offset))
        : 0;
      const limit = typeof normalized.args.limit === "number" && Number.isFinite(normalized.args.limit)
        ? Math.max(1, Math.trunc(normalized.args.limit))
        : lines.length;
      return { ok: true, text: lines.slice(offset, offset + limit).join("\n") };
    }

    if (normalized.tool === "write") {
      const targetPath = resolveToolPath(params.api, normalized.args.path);
      const content = typeof normalized.args.content === "string" ? normalized.args.content : "";
      await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.promises.writeFile(targetPath, content, "utf8");
      return { ok: true, text: `Wrote ${Buffer.byteLength(content, "utf8")} bytes to ${targetPath}` };
    }

    if (normalized.tool === "edit") {
      const targetPath = resolveToolPath(params.api, normalized.args.path);
      const oldText = typeof normalized.args.oldText === "string" ? normalized.args.oldText : "";
      const newText = typeof normalized.args.newText === "string" ? normalized.args.newText : "";
      if (!oldText) {
        return { ok: false, text: "Tool error: Missing required parameter: oldText" };
      }
      const current = await fs.promises.readFile(targetPath, "utf8");
      if (!current.includes(oldText)) {
        return { ok: false, text: "Tool error: oldText not found in file" };
      }
      await fs.promises.writeFile(targetPath, current.replace(oldText, newText), "utf8");
      return { ok: true, text: `Edited ${targetPath}` };
    }
  } catch (err) {
    return { ok: false, text: `Tool error: ${err instanceof Error ? err.message : String(err)}` };
  }

  return { ok: false, text: `Tool error: Unsupported local fallback tool: ${normalized.tool}` };
}

async function invokeOpenClawTool(params: {
  api: PluginApi;
  sessionKey: string;
  tool: string;
  args: Record<string, unknown>;
}) {
  const normalized = normalizeBrowserToolCall(params.tool, params.args);
  const cfg = params.api.config && typeof params.api.config === "object" && !Array.isArray(params.api.config)
    ? (params.api.config as Record<string, unknown>)
    : {};
  const gateway = cfg.gateway && typeof cfg.gateway === "object" && !Array.isArray(cfg.gateway)
    ? (cfg.gateway as Record<string, unknown>)
    : {};
  const port = typeof gateway.port === "number" ? gateway.port : 18789;
  const auth = gateway.auth && typeof gateway.auth === "object" && !Array.isArray(gateway.auth)
    ? (gateway.auth as Record<string, unknown>)
    : {};
  const token = typeof auth.token === "string" && auth.token.trim() ? auth.token.trim() : "";
  const toolSessionKey = "main";
  const body = JSON.stringify({
    tool: normalized.tool,
    args: normalized.args,
    sessionKey: toolSessionKey,
  });
  browserVoiceLog("tool_invoke_begin", {
    requestedSessionKey: params.sessionKey,
    toolSessionKey,
    tool: normalized.tool,
    argsPreview: clipForLog(safeJson(normalized.args), 300),
  });

  return await new Promise<{ ok: boolean; result?: unknown; text: string }>((resolve) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(body)),
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/tools/invoke",
        method: "POST",
        headers,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            const parsed = data ? JSON.parse(data) as Record<string, unknown> : {};
            if (parsed.ok === true) {
              const result = parsed.result;
              browserVoiceLog("tool_invoke_http_ok", {
                tool: normalized.tool,
                textPreview: clipForLog(extractToolResultText(result) || "Done.", 300),
              });
              resolve({
                ok: true,
                result,
                text: extractToolResultText(result) || "Done.",
              });
              return;
            }
            const errorPayload = parsed.error && typeof parsed.error === "object"
              ? parsed.error as Record<string, unknown>
              : parsed;
            const message = typeof errorPayload.message === "string" && errorPayload.message.trim()
              ? errorPayload.message.trim()
              : `tool invoke failed (${res.statusCode || 500})`;
            browserVoiceLog("tool_invoke_http_error", {
              tool: normalized.tool,
              statusCode: res.statusCode || null,
              message,
            });
            resolve({ ok: false, text: `Tool error: ${message}` });
          } catch {
            browserVoiceLog("tool_invoke_http_parse_error", {
              tool: normalized.tool,
            });
            resolve({ ok: false, text: "Tool error: could not parse OpenClaw response" });
          }
        });
      },
    );

    req.on("error", (err) => {
      browserVoiceLog("tool_invoke_http_request_error", {
        tool: normalized.tool,
        message: err.message,
      });
      resolve({ ok: false, text: `Tool error: ${err.message}` });
    });
    req.write(body);
    req.end();
  }).then(async (result) => {
    if (result.ok || !/tool not available:/i.test(result.text)) {
      return result;
    }
    browserVoiceLog("tool_invoke_local_fallback_begin", {
      tool: normalized.tool,
      reason: result.text,
    });
    const fallback = await invokeOpenClawToolLocally({
      api: params.api,
      tool: normalized.tool,
      args: normalized.args,
    });
    browserVoiceLog("tool_invoke_local_fallback_done", {
      tool: normalized.tool,
      ok: fallback.ok,
      textPreview: clipForLog(fallback.text, 300),
    });
    return fallback;
  });
}

function accessCodeDigest(accessCode: string): string {
  return createHash("sha256").update(accessCode).digest("hex");
}

function accessCodeMatches(configured: string, candidate: string): boolean {
  const expected = Buffer.from(accessCodeDigest(configured), "hex");
  const actual = Buffer.from(accessCodeDigest(candidate), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function createTrustedBrowserSession(
  config: BrowserVoiceConfig,
  label?: string,
): { token: string; record: TrustedBrowserRecord } {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + config.browserSessionTtlHours * 60 * 60 * 1000).toISOString();
  const token = randomUUID();
  return {
    token,
    record: {
      id: randomUUID(),
      label: label?.slice(0, 180),
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
    },
  };
}

function pruneExpiredSessions(store: TrustedBrowserStore): boolean {
  let changed = false;
  const now = Date.now();
  for (const [token, record] of Object.entries(store.sessions)) {
    const expiresAtMs = Date.parse(record.expiresAt || "");
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) {
      delete store.sessions[token];
      changed = true;
    }
  }
  return changed;
}

function resolveTrustedBrowser(req: any, config: BrowserVoiceConfig): { token: string; record: TrustedBrowserRecord } | null {
  const token = getCookie(req, COOKIE_NAME);
  if (!token) {
    return null;
  }
  const store = loadTrustStore();
  const pruned = pruneExpiredSessions(store);
  const record = store.sessions[token];
  if (!record) {
    if (pruned) {
      saveTrustStore(store);
    }
    return null;
  }
  const expiresAtMs = Date.parse(record.expiresAt || "");
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    delete store.sessions[token];
    saveTrustStore(store);
    return null;
  }
  record.lastSeenAt = new Date().toISOString();
  store.sessions[token] = record;
  saveTrustStore(store);
  browserVoiceLog("trusted_browser_resolved", {
    browserId: record.id,
    browserLabel: record.label ?? null,
    lastProvider: record.lastProvider ?? null,
  });
  return { token, record };
}

function ensureTrustedBrowser(req: any, config: BrowserVoiceConfig): TrustedBrowserRecord {
  const trusted = resolveTrustedBrowser(req, config);
  if (!trusted) {
    throw new Error("browser not authenticated");
  }
  return trusted.record;
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

function resolvePrimaryAgentModelRef(api: PluginApi) {
  const cfg = api.config && typeof api.config === "object" ? api.config as Record<string, unknown> : {};
  const agents = cfg.agents && typeof cfg.agents === "object" ? cfg.agents as Record<string, unknown> : {};
  const defaults = agents.defaults && typeof agents.defaults === "object" ? agents.defaults as Record<string, unknown> : {};
  const model = defaults.model && typeof defaults.model === "object" ? defaults.model as Record<string, unknown> : {};
  const primary = typeof model.primary === "string" && model.primary.trim()
    ? model.primary.trim()
    : "";
  return primary || "openai/gpt-4o-mini";
}

function ensureConversationRecord(params: {
  config: BrowserVoiceConfig;
  browser: TrustedBrowserRecord;
  provider: ProviderName;
  body: Record<string, unknown>;
}) {
  return ensureConversationRecordStore({
    deps: buildConversationStoreDeps(params.config.sessionKey),
    browser: params.browser as any,
    provider: params.provider,
    body: params.body,
  }) as ConversationRecord;
}

function updateConversationRecord(params: {
  conversationId: string;
  mutate: (conversation: ConversationRecord) => void;
}) {
  return updateConversationRecordStore({
    deps: buildConversationStoreDeps(),
    conversationId: params.conversationId,
    mutate: params.mutate as any,
  }) as ConversationRecord | null;
}

function browserCanAccessConversation(browserId: string, conversation: ConversationRecord) {
  return browserCanAccessConversationStore(browserId, conversation as any);
}

function getBrowserConversation(browserId: string, conversationId: string) {
  return getBrowserConversationStore(CONVERSATION_STORE_PATH, browserId, conversationId) as ConversationRecord | null;
}

function readSessionTranscriptPreview(sessionFile?: string): string {
  return summarizeText(readSessionTranscriptPreviewStore(sessionFile));
}

function buildConversationList(store: ConversationStore, browserId: string) {
  return buildConversationListStore(store as any, browserId, uniqueArray);
}

function serializeConversation(conversation: ConversationRecord) {
  return serializeConversationStore(conversation as any);
}

function serializeConversationList(payload: ReturnType<typeof buildConversationList>) {
  return serializeConversationListStore(payload as any);
}

function searchConversations(store: ConversationStore, query: string) {
  return searchConversationsStore(store as any, query) as ConversationRecord[];
}

function appendMessageToSessionTranscriptLocal(params: {
  agentId: string;
  sessionKey: string;
  role: "user" | "assistant";
  text?: string;
  idempotencyKey?: string;
}) {
  return appendMessageToSessionTranscriptLocalStore(params);
}

function persistConversationTranscript(params: {
  conversationId: string;
  role: "user" | "assistant";
  text: string;
  entryId: string;
}) {
  return persistConversationTranscriptStore({
    deps: buildConversationStoreDeps(),
    ...params,
  });
}

function readConversationThread(conversation: ConversationRecord, maxMessages = 80) {
  return readConversationThreadStore(conversation as any, maxMessages);
}

async function summarizeConversationForHistory(params: {
  api: PluginApi;
  conversation: ConversationRecord;
}) {
  const chatModelRef = resolvePrimaryAgentModelRef(params.api);
  const [chatProvider, ...chatModelParts] = chatModelRef.split("/");
  const chatModel = chatModelParts.join("/");
  if (chatProvider !== "openai" || !chatModel) {
    browserVoiceLog("conversation_summary_skipped", {
      conversationId: params.conversation.id,
      reason: `unsupported_default_model:${chatModelRef}`,
    });
    return null;
  }

  const transcript = readConversationThread(params.conversation, 200)
    .filter((entry) => !entry.synthetic)
    .map((entry) => `${entry.role === "assistant" ? "Assistant" : "User"}: ${entry.text}`)
    .join("\n\n")
    .trim();
  if (!transcript) {
    return null;
  }

  const apiKey = await resolveProviderApiKey(params.api, "openai");
  return await summarizeOpenAiConversationProvider({
    apiKey,
    transcript,
    model: chatModel,
    deps: {
      browserVoiceLog,
      clipForLog,
    },
  });
}

function buildOpenAiProviderDeps(api: PluginApi) {
  return {
    resolveProviderApiKey,
    buildToolInstructions,
    buildOpenAiToolDefinition,
    invokeOpenClawTool,
    readConversationThread,
    browserVoiceLog,
    clipForLog,
  };
}

function buildGeminiProviderDeps(api: PluginApi) {
  return {
    resolveProviderApiKey,
    buildGeminiToolDefinition,
    buildToolInstructions,
    browserVoiceLog,
  };
}

function buildConversationStoreDeps(sessionKeyBase = "") {
  return {
    agentId: AGENT_ID,
    sessionKeyBase,
    conversationStorePath: CONVERSATION_STORE_PATH,
    validateBodyString,
    uniqueArray,
    summarizeText,
    clipForLog,
    browserVoiceLog,
  };
}

function getConversationOrNull(conversationId: string) {
  const store = loadConversationStore();
  return store.conversations[conversationId] ?? null;
}

function pluginStatus(api: PluginApi, config: BrowserVoiceConfig, req?: any) {
  const trusted = req ? resolveTrustedBrowser(req, config) : null;
  const publicHost = resolvePublicHost(config);
  const conversations = trusted ? buildConversationList(loadConversationStore(), trusted.record.id) : null;
  return {
    id: PLUGIN_ID,
    name: PLUGIN_NAME,
    enabled: config.enabled,
    routeBase: config.routeBase,
    defaultProvider: config.defaultProvider,
    authenticated: !!trusted,
    browser: trusted?.record ?? null,
    sessionKey: config.sessionKey,
    tools: buildToolUsageSummary(api),
    currentConversationId: conversations?.currentConversationId ?? null,
    accessCodeConfigured: !!config.browserAccessCode.trim(),
    https: {
      enabled: config.serve.enabled,
      bind: config.serve.bind,
      port: config.serve.port,
      publicHost,
      url: `https://${publicHost}:${config.serve.port}${config.routeBase}/`,
    },
  };
}

function getLocalIpv4Addresses(): string[] {
  const interfaces = os.networkInterfaces();
  const addresses = new Set<string>();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry && entry.family === "IPv4" && !entry.internal) {
        addresses.add(entry.address);
      }
    }
  }
  return [...addresses];
}

function resolvePublicHost(config: BrowserVoiceConfig): string {
  if (config.serve.publicHost?.trim()) {
    return config.serve.publicHost.trim();
  }
  const ips = getLocalIpv4Addresses();
  return ips[0] ?? "127.0.0.1";
}

function buildRouteDefinitions(api: PluginApi, config: BrowserVoiceConfig): RouteDefinition[] {
  return [
    ...buildStaticRoutes({
      routeBase: config.routeBase,
      ensureEnabled: () => ensureEnabled(config),
      sendText,
      readUiAsset,
    }),
    ...buildDiagnosticRoutes({
      routeBase: config.routeBase,
      api,
      config,
      ensureEnabled: () => ensureEnabled(config),
      requireAllowedOrigin,
      withCors,
      resolveProviderApiKey,
      pluginStatus,
      resolvePrimaryAgentModelRef,
      ensureTrustedBrowser,
      resolveTrustedBrowser,
      readJsonBody,
      validateBodyString,
      browserVoiceLog,
      clipForLog,
      safeJson,
      readSanitizedToolTrace,
      readSanitizedSessionTrace,
      readPluginLogTail,
      buildToolUsageSummary,
      buildOpenAiToolDefinition,
      buildGeminiToolDefinition,
      buildToolInstructions,
      resolveToolPolicy,
      loadConversationStore,
      invokeOpenClawTool,
      sendJson,
    }),
    ...buildProviderRoutes({
      routeBase: config.routeBase,
      config,
      ensureEnabled: () => ensureEnabled(config),
      requireAllowedOrigin,
      withCors,
      ensureTrustedBrowser,
      loadTrustStore,
      saveTrustStore,
      getCookie,
      cookieName: COOKIE_NAME,
      readJsonBody,
      createOpenAiClientSecret: createOpenAiClientSecretProvider,
      createGeminiEphemeralToken,
      buildOpenAiProviderDeps,
      buildGeminiProviderDeps,
      sendJson,
      api,
    }),
    ...buildConversationRoutes({
      routeBase: config.routeBase,
      api,
      config,
      ensureEnabled: () => ensureEnabled(config),
      requireAllowedOrigin,
      withCors,
      ensureTrustedBrowser,
      loadConversationStore,
      buildConversationList,
      serializeConversationList,
      getConversationOrNull,
      serializeConversation,
      readJsonBody,
      validateBodyString,
      searchConversations,
      browserCanAccessConversation,
      updateConversationRecord,
      summarizeText,
      summarizeConversationForHistory,
      readConversationThread,
      sendJson,
    }),
    ...buildSessionRoutes({
      routeBase: config.routeBase,
      api,
      config,
      ensureEnabled: () => ensureEnabled(config),
      requireAllowedOrigin,
      withCors,
      enforceLoginThrottle,
      readJsonBody,
      validateBodyString,
      accessCodeMatches,
      registerLoginFailure,
      clearLoginFailure,
      createTrustedBrowserSession,
      loadTrustStore,
      pruneExpiredSessions,
      saveTrustStore,
      setCookie,
      cookieName: COOKIE_NAME,
      getCookie,
      clearCookie,
      ensureTrustedBrowser,
      ensureConversationRecord,
      appendMessageToSessionTranscriptLocal,
      updateConversationRecord,
      serializeConversation,
      readSessionTranscriptPreview,
      loadConversationStore,
      browserCanAccessConversation,
      summarizeText,
      readConversationThread,
      summarizeConversationForHistory,
      sendJson,
      agentId: AGENT_ID,
    }),
    ...buildChatRoutes({
      routeBase: config.routeBase,
      api,
      config,
      ensureEnabled: () => ensureEnabled(config),
      requireAllowedOrigin,
      withCors,
      ensureTrustedBrowser,
      readJsonBody,
      validateBodyString,
      loadConversationStore,
      browserCanAccessConversation,
      resolvePrimaryAgentModelRef,
      resolveProviderApiKey,
      appendMessageToSessionTranscriptLocal,
      updateConversationRecord,
      summarizeText,
      randomIdSuffix: () => randomUUID().slice(0, 6),
      runOpenAiTextTurn: runOpenAiTextTurnProvider,
      transcribeOpenAiAudio: transcribeOpenAiAudioProvider,
      synthesizeOpenAiSpeech: synthesizeOpenAiSpeechProvider,
      browserVoiceLog,
      clipForLog,
      buildOpenAiProviderDeps,
      sendJson,
      agentId: AGENT_ID,
    }),
  ];
}

function registerGatewayRoutes(api: PluginApi, routes: RouteDefinition[]) {
  for (const route of routes) {
    api.registerHttpRoute?.({
      path: route.path,
      auth: "plugin",
      handler: async (req, res) => {
        if (!route.methods.includes(String(req.method || "GET").toUpperCase())) {
          return;
        }
        try {
          await route.handler(req, res);
          return true;
        } catch (err) {
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
          return true;
        }
      },
    });
  }
}

function ensureTlsFiles(config: BrowserVoiceConfig, logger: PluginApi["logger"]) {
  ensureTlsDir();
  if (fs.existsSync(config.serve.certPath) && fs.existsSync(config.serve.keyPath)) {
    return;
  }
  if (!config.serve.autoSelfSigned) {
    throw new Error(`TLS cert/key missing: ${config.serve.certPath} / ${config.serve.keyPath}`);
  }
  const sanEntries = new Set<string>([
    "DNS:localhost",
    "IP:127.0.0.1",
  ]);
  for (const ip of getLocalIpv4Addresses()) {
    sanEntries.add(`IP:${ip}`);
  }
  const publicHost = resolvePublicHost(config);
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(publicHost)) {
    sanEntries.add(`IP:${publicHost}`);
  } else if (publicHost) {
    sanEntries.add(`DNS:${publicHost}`);
  }

  execFileSync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-sha256",
    "-nodes",
    "-days",
    "365",
    "-subj",
    "/CN=localhost",
    "-keyout",
    config.serve.keyPath,
    "-out",
    config.serve.certPath,
    "-addext",
    `subjectAltName=${[...sanEntries].join(",")}`,
  ], {
    stdio: "ignore",
  });
  logger.warn(
    `[${PLUGIN_ID}] generated self-signed TLS cert at ${config.serve.certPath} for ${[...sanEntries].join(", ")}. iPhone devices will still require a trusted cert for mic access.`,
  );
}

function createStandaloneHttpsServer(
  api: PluginApi,
  config: BrowserVoiceConfig,
  routes: RouteDefinition[],
  extras?: {
    attach?: (server: https.Server) => void;
    stop?: () => Promise<void>;
  },
) {
  let server: https.Server | null = null;

  return {
    id: `${PLUGIN_ID}-https`,
    async start() {
      if (!config.serve.enabled) {
        api.logger.info(`[${PLUGIN_ID}] standalone HTTPS server disabled`);
        return;
      }
      ensureTlsFiles(config, api.logger);
      const cert = fs.readFileSync(config.serve.certPath, "utf8");
      const key = fs.readFileSync(config.serve.keyPath, "utf8");

      server = https.createServer({ cert, key }, async (req, res) => {
        const url = new URL(req.url || "/", "https://browser-voice.local");
        const pathname = url.pathname;
        const method = String(req.method || "GET").toUpperCase();
        const route = routes.find((entry) => entry.path === pathname && entry.methods.includes(method));

        if (!route) {
          withCors(req, res, config);
          sendJson(res, 404, { error: "not found" });
          return;
        }

        try {
          await route.handler(req, res);
        } catch (err) {
          withCors(req, res, config);
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      });
      extras?.attach?.(server);

      await new Promise<void>((resolve, reject) => {
        server?.once("error", reject);
        server?.listen(config.serve.port, config.serve.bind, () => resolve());
      });

      const publicHost = resolvePublicHost(config);
      api.logger.info(
        `[${PLUGIN_ID}] standalone HTTPS server listening at https://${publicHost}:${config.serve.port}${config.routeBase}/`,
      );
    },
    async stop() {
      if (!server) {
        return;
      }
      const activeServer = server;
      server = null;
      await extras?.stop?.();
      await new Promise<void>((resolve, reject) => {
        activeServer.close((err) => (err ? reject(err) : resolve()));
      });
      api.logger.info(`[${PLUGIN_ID}] standalone HTTPS server stopped`);
    },
  };
}

export default {
  id: PLUGIN_ID,
  name: PLUGIN_NAME,
  description: "Browser-first voice gateway for OpenClaw with OpenAI and Gemini bootstrap routes.",
  configSchema: {
    parse(value: unknown) {
      return resolveConfig(value);
    },
  },
  register(api: PluginApi) {
    const config = resolveConfig(api.pluginConfig);
    api.logger.info(`[${PLUGIN_ID}] register routeBase=${config.routeBase}`);
    const routes = buildRouteDefinitions(api, config);
    const geminiBridge = createGeminiLiveBridge({
      routeBase: config.routeBase,
      resolveTrustedBrowser: (req) => {
        const trusted = resolveTrustedBrowser(req, config);
        return trusted?.record ?? null;
      },
      getConversationForBrowser: (browserId, conversationId) => getBrowserConversation(browserId, conversationId),
      createBootstrap: () => createGeminiEphemeralToken({
        api,
        config,
        deps: buildGeminiProviderDeps(api),
      }),
      persistTranscript: (params) => persistConversationTranscript(params),
      invokeTool: ({ conversationId, sessionKey, tool, args }) => invokeOpenClawTool({
        api,
        sessionKey,
        tool,
        args,
      }).then((result) => {
        browserVoiceLog("gemini_bridge_tool_result", {
          conversationId,
          tool,
          ok: result.ok,
          textPreview: clipForLog(result.text, 300),
        });
        return result;
      }),
      browserVoiceLog,
    });
    registerGatewayRoutes(api, routes);
    api.registerService?.(createStandaloneHttpsServer(api, config, routes, geminiBridge));

    api.registerGatewayMethod?.("browser.voice.status", async ({ respond, context, client }: any) => {
      try {
        ensureEnabled(config);
        const req = { headers: { cookie: typeof client?.connect?.cookie === "string" ? client.connect.cookie : "" } };
        const [openai, google] = await Promise.all([
          resolveProviderApiKey(api, "openai").then(() => true).catch(() => false),
          resolveProviderApiKey(api, "google").then(() => true).catch(() => false),
        ]);
        respond(true, {
          ...pluginStatus(api, config, req),
          providers: { openai, google },
          sessionKey: config.sessionKey,
          routeBase: config.routeBase,
          hasBroadcastContext: !!context,
        });
      } catch (err) {
        respond(false, { error: err instanceof Error ? err.message : String(err) });
      }
    });
  },
};

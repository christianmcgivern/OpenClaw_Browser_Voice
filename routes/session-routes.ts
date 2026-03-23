import { type RouteDefinition } from "./static-routes.ts";

export function buildSessionRoutes(params: {
  routeBase: string;
  config: any;
  ensureEnabled: () => void;
  requireAllowedOrigin: (req: any, config: any) => void;
  withCors: (req: any, res: any, config: any) => void;
  enforceLoginThrottle: (req: any) => void;
  readJsonBody: (req: any) => Promise<Record<string, unknown>>;
  validateBodyString: (value: unknown, maxLength: number) => string;
  accessCodeMatches: (expected: string, supplied: string) => boolean;
  registerLoginFailure: (req: any) => void;
  clearLoginFailure: (req: any) => void;
  createTrustedBrowserSession: (config: any, label?: string) => { token: string; record: any };
  loadTrustStore: () => any;
  pruneExpiredSessions: (store: any) => void;
  saveTrustStore: (store: any) => void;
  setCookie: (req: any, res: any, name: string, value: string, maxAgeSeconds: number) => void;
  cookieName: string;
  getCookie: (req: any, name: string) => string | undefined;
  clearCookie: (req: any, res: any, name: string) => void;
  ensureTrustedBrowser: (req: any, config: any) => any;
  ensureConversationRecord: (params: {
    config: any;
    browser: any;
    provider: "openai" | "google";
    body: Record<string, unknown>;
  }) => any;
  appendMessageToSessionTranscriptLocal: (params: {
    agentId: string;
    sessionKey: string;
    role: "assistant" | "user";
    text: string;
    idempotencyKey: string;
  }) => { ok: boolean; reason?: string; sessionFile?: string };
  updateConversationRecord: (params: {
    conversationId: string;
    mutate: (entry: any) => void;
  }) => any;
  serializeConversation: (conversation: any) => any;
  readSessionTranscriptPreview: (sessionFile?: string) => string;
  loadConversationStore: () => any;
  browserCanAccessConversation: (browserId: string, conversation: any) => boolean;
  summarizeText: (text: string, max?: number) => string;
  readConversationThread: (conversation: any, maxMessages?: number) => Array<{
    id: string;
    role: string;
    text: string;
    timestamp: string;
    synthetic: boolean;
  }>;
  summarizeConversationForHistory: (params: {
    api: any;
    conversation: any;
  }) => Promise<{ title: string; summary: string } | null>;
  api: any;
  sendJson: (res: any, statusCode: number, body: unknown) => void;
  agentId: string;
}): RouteDefinition[] {
  return [
    {
      path: `${params.routeBase}/api/session/login`,
      methods: ["POST", "OPTIONS"],
      handler: async (req, res) => {
        params.ensureEnabled();
        params.requireAllowedOrigin(req, params.config);
        params.withCors(req, res, params.config);
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end("");
          return;
        }
        params.enforceLoginThrottle(req);
        const body = await params.readJsonBody(req);
        const accessCode = params.validateBodyString(body.accessCode, 256);
        if (!accessCode || !params.accessCodeMatches(params.config.browserAccessCode, accessCode)) {
          params.registerLoginFailure(req);
          params.sendJson(res, 401, { error: "invalid access code" });
          return;
        }
        params.clearLoginFailure(req);

        const { token, record } = params.createTrustedBrowserSession(
          params.config,
          params.validateBodyString(body.label, 180) || undefined,
        );
        const store = params.loadTrustStore();
        params.pruneExpiredSessions(store);
        store.sessions[token] = record;
        params.saveTrustStore(store);
        params.setCookie(req, res, params.cookieName, token, params.config.browserSessionTtlHours * 60 * 60);
        params.sendJson(res, 200, {
          ok: true,
          browser: record,
        });
      },
    },
    {
      path: `${params.routeBase}/api/session/logout`,
      methods: ["POST", "OPTIONS"],
      handler: async (req, res) => {
        params.ensureEnabled();
        params.requireAllowedOrigin(req, params.config);
        params.withCors(req, res, params.config);
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end("");
          return;
        }
        const token = params.getCookie(req, params.cookieName);
        if (token) {
          const store = params.loadTrustStore();
          delete store.sessions[token];
          params.saveTrustStore(store);
        }
        params.clearCookie(req, res, params.cookieName);
        params.sendJson(res, 200, { ok: true });
      },
    },
    {
      path: `${params.routeBase}/api/session/start`,
      methods: ["POST", "OPTIONS"],
      handler: async (req, res) => {
        params.ensureEnabled();
        params.requireAllowedOrigin(req, params.config);
        params.withCors(req, res, params.config);
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end("");
          return;
        }
        const browser = params.ensureTrustedBrowser(req, params.config);
        const body = await params.readJsonBody(req);
        const provider = body.provider === "google" ? "google" : "openai";
        const conversation = params.ensureConversationRecord({
          config: params.config,
          browser,
          provider,
          body,
        });
        const note = `Browser voice session started for ${browser.label || browser.id} using ${provider}.`;
        const result = params.appendMessageToSessionTranscriptLocal({
          agentId: params.agentId,
          sessionKey: conversation.sessionKey,
          role: "assistant",
          text: note,
          idempotencyKey: `browser-voice-open:${conversation.id}`,
        });
        if (!result.ok) {
          throw new Error(result.reason);
        }
        params.updateConversationRecord({
          conversationId: conversation.id,
          mutate(entry) {
            entry.provider = provider;
            entry.sessionFile = result.sessionFile;
            entry.preview = params.readSessionTranscriptPreview(result.sessionFile);
            entry.lastMessageAt = new Date().toISOString();
          },
        });
        params.sendJson(res, 200, {
          ok: true,
          conversationId: conversation.id,
          sessionKey: conversation.sessionKey,
          conversation: params.serializeConversation(conversation),
        });
      },
    },
    {
      path: `${params.routeBase}/api/session/end`,
      methods: ["POST", "OPTIONS"],
      handler: async (req, res) => {
        params.ensureEnabled();
        params.requireAllowedOrigin(req, params.config);
        params.withCors(req, res, params.config);
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end("");
          return;
        }
        const browser = params.ensureTrustedBrowser(req, params.config);
        const body = await params.readJsonBody(req);
        const conversationId = params.validateBodyString(body.conversationId, 120);
        const provider = body.provider === "google" ? "google" : "openai";
        if (!conversationId) {
          params.sendJson(res, 400, { error: "conversationId required" });
          return;
        }
        const store = params.loadConversationStore();
        const conversation = store.conversations[conversationId];
        if (!conversation) {
          params.sendJson(res, 404, { error: "unknown conversationId" });
          return;
        }
        const note = `Browser voice session ended for ${browser.label || browser.id} using ${provider}.`;
        const result = params.appendMessageToSessionTranscriptLocal({
          agentId: params.agentId,
          sessionKey: conversation.sessionKey,
          role: "assistant",
          text: note,
          idempotencyKey: `browser-voice-close:${conversationId}`,
        });
        if (!result.ok) {
          throw new Error(result.reason);
        }
        params.updateConversationRecord({
          conversationId,
          mutate(entry) {
            entry.provider = provider;
            entry.sessionFile = result.sessionFile;
            entry.preview = params.readSessionTranscriptPreview(result.sessionFile);
            entry.lastMessageAt = new Date().toISOString();
          },
        });
        const refreshedStore = params.loadConversationStore();
        const refreshedConversation = refreshedStore.conversations[conversationId];
        if (refreshedConversation) {
          try {
            const summary = await params.summarizeConversationForHistory({
              api: params.api,
              conversation: refreshedConversation,
            });
            if (summary) {
              params.updateConversationRecord({
                conversationId,
                mutate(entry) {
                  entry.title = params.summarizeText(summary.title, 80) || entry.title;
                  entry.summary = params.summarizeText(summary.summary, 1600);
                  entry.preview = params.summarizeText(summary.summary, 220);
                  entry.lastMessageAt = new Date().toISOString();
                },
              });
            }
          } catch {
            // summary generation is best-effort and should not break session end
          }
        }
        params.sendJson(res, 200, { ok: true });
      },
    },
    {
      path: `${params.routeBase}/api/session/transcript`,
      methods: ["POST", "OPTIONS"],
      handler: async (req, res) => {
        params.ensureEnabled();
        params.requireAllowedOrigin(req, params.config);
        params.withCors(req, res, params.config);
        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end("");
          return;
        }
        const browser = params.ensureTrustedBrowser(req, params.config);
        const body = await params.readJsonBody(req);
        const role = body.role === "user" ? "user" : body.role === "assistant" ? "assistant" : "";
        const text = params.validateBodyString(body.text, 12000);
        const conversationId = params.validateBodyString(body.conversationId, 120);
        const entryId = params.validateBodyString(body.entryId, 180);
        if (!role || !text || !conversationId || !entryId) {
          params.sendJson(res, 400, { error: "role, text, conversationId, and entryId required" });
          return;
        }
        const store = params.loadConversationStore();
        const conversation = store.conversations[conversationId];
        if (!conversation) {
          params.sendJson(res, 404, { error: "unknown conversationId" });
          return;
        }
        if (!params.browserCanAccessConversation(browser.id, conversation)) {
          params.sendJson(res, 403, { error: "conversation not accessible on this browser" });
          return;
        }
        const result = params.appendMessageToSessionTranscriptLocal({
          agentId: params.agentId,
          sessionKey: conversation.sessionKey,
          role,
          text,
          idempotencyKey: `browser-voice:${conversationId}:${entryId}`,
        });
        if (!result.ok) {
          throw new Error(result.reason);
        }
        params.updateConversationRecord({
          conversationId,
          mutate(entry) {
            entry.sessionFile = result.sessionFile;
            entry.preview = params.summarizeText(text);
            if (!entry.title || entry.title === `${entry.provider === "google" ? "Gemini" : "OpenAI"} conversation`) {
              entry.title = params.summarizeText(text, 48) || entry.title;
            }
            entry.lastMessageAt = new Date().toISOString();
          },
        });
        params.sendJson(res, 200, { ok: true });
      },
    },
  ];
}

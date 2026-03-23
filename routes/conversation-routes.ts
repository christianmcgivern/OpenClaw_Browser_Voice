import { type RouteDefinition } from "./static-routes.ts";

export function buildConversationRoutes(params: {
  routeBase: string;
  config: any;
  ensureEnabled: () => void;
  requireAllowedOrigin: (req: any, config: any) => void;
  withCors: (req: any, res: any, config: any) => void;
  ensureTrustedBrowser: (req: any, config: any) => any;
  loadConversationStore: () => any;
  buildConversationList: (store: any, browserId: string) => any;
  serializeConversationList: (list: any) => any;
  getConversationOrNull: (conversationId: string) => any;
  serializeConversation: (conversation: any) => any;
  readJsonBody: (req: any) => Promise<Record<string, unknown>>;
  validateBodyString: (value: unknown, maxLength: number) => string;
  searchConversations: (store: any, query: string) => any[];
  browserCanAccessConversation: (browserId: string, conversation: any) => boolean;
  updateConversationRecord: (params: {
    conversationId: string;
    mutate: (entry: any) => void;
  }) => any;
  summarizeText: (text: string, max?: number) => string;
  summarizeConversationForHistory: (params: {
    api: any;
    conversation: any;
  }) => Promise<{ title: string; summary: string } | null>;
  api: any;
  readConversationThread: (conversation: any, maxMessages?: number) => Array<{
    id: string;
    role: string;
    text: string;
    timestamp: string;
    synthetic: boolean;
  }>;
  sendJson: (res: any, statusCode: number, body: unknown) => void;
}): RouteDefinition[] {
  return [
    {
      path: `${params.routeBase}/api/conversations`,
      methods: ["GET", "OPTIONS"],
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
        const store = params.loadConversationStore();
        params.sendJson(res, 200, params.serializeConversationList(params.buildConversationList(store, browser.id)));
      },
    },
    {
      path: `${params.routeBase}/api/conversations/current`,
      methods: ["GET", "OPTIONS"],
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
        const list = params.buildConversationList(params.loadConversationStore(), browser.id);
        const conversation = list.currentConversationId
          ? params.getConversationOrNull(list.currentConversationId)
          : null;
        params.sendJson(res, 200, { conversation: conversation ? params.serializeConversation(conversation) : null });
      },
    },
    {
      path: `${params.routeBase}/api/conversations/search`,
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
        params.ensureTrustedBrowser(req, params.config);
        const body = await params.readJsonBody(req);
        const query = params.validateBodyString(body.query, 200);
        const store = params.loadConversationStore();
        params.sendJson(res, 200, {
          results: params.searchConversations(store, query).map(params.serializeConversation),
        });
      },
    },
    {
      path: `${params.routeBase}/api/conversations/thread`,
      methods: ["GET", "OPTIONS"],
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
        const url = new URL(req.url || `${params.routeBase}/api/conversations/thread`, "https://browser-voice.local");
        const conversationId = params.validateBodyString(url.searchParams.get("conversationId"), 120);
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
        if (!params.browserCanAccessConversation(browser.id, conversation)) {
          params.sendJson(res, 403, { error: "conversation not accessible on this browser" });
          return;
        }
        params.sendJson(res, 200, {
          ok: true,
          conversationId,
          messages: params.readConversationThread(conversation, 120)
            .filter((entry) => !entry.synthetic)
            .map((entry) => ({
              id: entry.id,
              role: entry.role,
              text: entry.text,
              timestamp: entry.timestamp,
            })),
        });
      },
    },
    {
      path: `${params.routeBase}/api/conversations/summarize`,
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
        if (!params.browserCanAccessConversation(browser.id, conversation)) {
          params.sendJson(res, 403, { error: "conversation not accessible on this browser" });
          return;
        }
        const summary = await params.summarizeConversationForHistory({
          api: params.api,
          conversation,
        });
        if (!summary) {
          params.sendJson(res, 200, {
            ok: true,
            conversationId,
            title: conversation.title,
            summary: conversation.summary || "",
          });
          return;
        }
        const updated = params.updateConversationRecord({
          conversationId,
          mutate(entry) {
            entry.title = params.summarizeText(summary.title, 80) || entry.title;
            entry.summary = params.summarizeText(summary.summary, 1600);
            entry.preview = params.summarizeText(summary.summary, 220);
          },
        });
        params.sendJson(res, 200, {
          ok: true,
          conversationId,
          title: updated?.title || summary.title,
          summary: updated?.summary || summary.summary,
        });
      },
    },
  ];
}

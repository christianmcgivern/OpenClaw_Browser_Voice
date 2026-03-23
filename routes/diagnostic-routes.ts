import { type RouteDefinition } from "./static-routes.ts";

export function buildDiagnosticRoutes(params: {
  routeBase: string;
  api: any;
  config: any;
  ensureEnabled: () => void;
  requireAllowedOrigin: (req: any, config: any) => void;
  withCors: (req: any, res: any, config: any) => void;
  resolveProviderApiKey: (api: any, provider: "openai" | "google") => Promise<string>;
  pluginStatus: (api: any, config: any, req: any) => Record<string, unknown>;
  resolvePrimaryAgentModelRef: (api: any) => string;
  ensureTrustedBrowser: (req: any, config: any) => any;
  resolveTrustedBrowser: (req: any, config: any) => { record: any } | null;
  readJsonBody: (req: any) => Promise<Record<string, unknown>>;
  validateBodyString: (value: unknown, maxLength: number) => string;
  browserVoiceLog: (event: string, details?: Record<string, unknown>) => void;
  clipForLog: (value: string, max?: number) => string;
  safeJson: (value: unknown) => string;
  readSanitizedToolTrace: (lines: number) => unknown[];
  readSanitizedSessionTrace: (lines: number) => unknown[];
  readPluginLogTail: (lines: number) => string;
  buildToolUsageSummary: (api: any) => Record<string, unknown>;
  buildOpenAiToolDefinition: () => any[];
  buildGeminiToolDefinition: () => any[];
  buildToolInstructions: (api: any) => string;
  resolveToolPolicy: (api: any) => { profile: string; deny: string[] };
  loadConversationStore: () => any;
  invokeOpenClawTool: (params: {
    api: any;
    sessionKey: string;
    tool: string;
    args: Record<string, unknown>;
  }) => Promise<{ ok: boolean; text: string } & Record<string, unknown>>;
  sendJson: (res: any, statusCode: number, body: unknown) => void;
}): RouteDefinition[] {
  return [
    {
      path: `${params.routeBase}/api/status`,
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
        const [openai, google] = await Promise.all([
          params.resolveProviderApiKey(params.api, "openai").then(() => true).catch(() => false),
          params.resolveProviderApiKey(params.api, "google").then(() => true).catch(() => false),
        ]);
        params.sendJson(res, 200, {
          ...params.pluginStatus(params.api, params.config, req),
          providers: { openai, google },
          chatModel: params.resolvePrimaryAgentModelRef(params.api),
          models: {
            openai: params.config.openaiModel,
            google: params.config.geminiModel,
          },
        });
      },
    },
    {
      path: `${params.routeBase}/api/client-log`,
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
        const trusted = params.resolveTrustedBrowser(req, params.config);
        const body = await params.readJsonBody(req);
        params.browserVoiceLog("client_trace", {
          browserId: trusted?.record.id ?? null,
          browserLabel: trusted?.record.label ?? null,
          level: params.validateBodyString(body.level, 24) || "info",
          message: params.validateBodyString(body.message, 400),
          conversationId: params.validateBodyString(body.conversationId, 120) || null,
          dataPreview: params.clipForLog(params.safeJson(body.data), 500),
        });
        params.sendJson(res, 200, { ok: true });
      },
    },
    {
      path: `${params.routeBase}/api/logs`,
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
        params.ensureTrustedBrowser(req, params.config);
        const url = new URL(req.url || `${params.routeBase}/api/logs`, "https://browser-voice.local");
        const linesRaw = url.searchParams.get("lines");
        const lines = linesRaw ? Math.min(1000, Math.max(20, Number.parseInt(linesRaw, 10) || 200)) : 200;
        const scope = url.searchParams.get("scope") || "all";
        if (scope === "tools") {
          params.sendJson(res, 200, { ok: true, scope, lines, entries: params.readSanitizedToolTrace(lines) });
          return;
        }
        if (scope === "session") {
          params.sendJson(res, 200, { ok: true, scope, lines, entries: params.readSanitizedSessionTrace(lines) });
          return;
        }
        params.sendJson(res, 200, {
          ok: true,
          lines,
          content: params.readPluginLogTail(lines),
        });
      },
    },
    {
      path: `${params.routeBase}/api/tools/manifest`,
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
        params.ensureTrustedBrowser(req, params.config);
        params.sendJson(res, 200, {
          ok: true,
          ...params.buildToolUsageSummary(params.api),
          openai: params.buildOpenAiToolDefinition(),
          gemini: params.buildGeminiToolDefinition(),
          instructions: params.buildToolInstructions(params.api),
        });
      },
    },
    {
      path: `${params.routeBase}/api/tools/invoke`,
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
        const tool = params.validateBodyString(body.tool, 120);
        const conversationId = params.validateBodyString(body.conversationId, 120);
        const args = body.args && typeof body.args === "object" && !Array.isArray(body.args)
          ? body.args as Record<string, unknown>
          : {};

        params.browserVoiceLog("tool_trace_route_begin", {
          browserId: browser.id,
          browserLabel: browser.label ?? null,
          conversationId,
          tool,
          argsPreview: params.clipForLog(params.safeJson(args), 300),
        });

        if (!tool || !conversationId) {
          params.browserVoiceLog("tool_trace_route_rejected", {
            browserId: browser.id,
            reason: "missing tool or conversationId",
          });
          params.sendJson(res, 400, { error: "tool and conversationId required" });
          return;
        }

        const policy = params.resolveToolPolicy(params.api);
        if (policy.deny.includes(tool)) {
          params.browserVoiceLog("tool_trace_route_denied", {
            browserId: browser.id,
            conversationId,
            tool,
          });
          params.sendJson(res, 403, { error: `tool denied for browser sessions: ${tool}` });
          return;
        }

        const store = params.loadConversationStore();
        const conversation = store.conversations[conversationId];
        if (!conversation) {
          params.browserVoiceLog("tool_trace_route_missing_conversation", {
            browserId: browser.id,
            conversationId,
            tool,
          });
          params.sendJson(res, 404, { error: "unknown conversationId" });
          return;
        }
        if (!conversation.ownerBrowserIds.includes(browser.id) && conversation.mode !== "shared") {
          params.browserVoiceLog("tool_trace_route_wrong_browser", {
            browserId: browser.id,
            conversationId,
            tool,
          });
          params.sendJson(res, 403, { error: "conversation is not available on this browser" });
          return;
        }

        const result = await params.invokeOpenClawTool({
          api: params.api,
          sessionKey: conversation.sessionKey,
          tool,
          args,
        });
        params.browserVoiceLog("tool_trace_route_result", {
          browserId: browser.id,
          conversationId,
          tool,
          ok: result.ok,
          textPreview: params.clipForLog(result.text, 300),
        });
        params.sendJson(res, result.ok ? 200 : 500, result);
      },
    },
  ];
}

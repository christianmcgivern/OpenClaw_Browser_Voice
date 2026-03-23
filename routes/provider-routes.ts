import { type RouteDefinition } from "./static-routes.ts";

export function buildProviderRoutes(params: {
  routeBase: string;
  config: any;
  ensureEnabled: () => void;
  requireAllowedOrigin: (req: any, config: any) => void;
  withCors: (req: any, res: any, config: any) => void;
  ensureTrustedBrowser: (req: any, config: any) => any;
  loadTrustStore: () => any;
  saveTrustStore: (store: any) => void;
  getCookie: (req: any, name: string) => string | undefined;
  cookieName: string;
  readJsonBody: (req: any) => Promise<Record<string, unknown>>;
  createOpenAiClientSecret: (params: { api: any; config: any; body: Record<string, unknown>; deps: any }) => Promise<unknown>;
  createGeminiEphemeralToken: (params: { api: any; config: any; deps: any }) => Promise<unknown>;
  buildOpenAiProviderDeps: (api: any) => any;
  buildGeminiProviderDeps: (api: any) => any;
  sendJson: (res: any, statusCode: number, body: unknown) => void;
  api: any;
}): RouteDefinition[] {
  return [
    {
      path: `${params.routeBase}/api/bootstrap/openai`,
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
        const trusted = params.ensureTrustedBrowser(req, params.config);
        trusted.lastProvider = "openai";
        const store = params.loadTrustStore();
        const token = params.getCookie(req, params.cookieName);
        if (token && store.sessions[token]) {
          store.sessions[token] = trusted;
          params.saveTrustStore(store);
        }
        const body = await params.readJsonBody(req);
        const payload = await params.createOpenAiClientSecret({
          api: params.api,
          config: params.config,
          body,
          deps: params.buildOpenAiProviderDeps(params.api),
        });
        params.sendJson(res, 200, payload);
      },
    },
    {
      path: `${params.routeBase}/api/bootstrap/gemini`,
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
        const trusted = params.ensureTrustedBrowser(req, params.config);
        trusted.lastProvider = "google";
        const store = params.loadTrustStore();
        const token = params.getCookie(req, params.cookieName);
        if (token && store.sessions[token]) {
          store.sessions[token] = trusted;
          params.saveTrustStore(store);
        }
        const payload = await params.createGeminiEphemeralToken({
          api: params.api,
          config: params.config,
          deps: params.buildGeminiProviderDeps(params.api),
        });
        params.sendJson(res, 200, payload);
      },
    },
  ];
}

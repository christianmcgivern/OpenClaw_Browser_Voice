type RouteDefinition = {
  path: string;
  methods: string[];
  handler: (req: any, res: any) => Promise<void> | void;
};

export function buildStaticRoutes(params: {
  routeBase: string;
  ensureEnabled: () => void;
  sendText: (res: any, statusCode: number, body: string, contentType?: string) => void;
  readUiAsset: (relativePath: string) => string;
}): RouteDefinition[] {
  const html = "text/html; charset=utf-8";
  const js = "text/javascript; charset=utf-8";
  const css = "text/css; charset=utf-8";

  return [
    {
      path: params.routeBase,
      methods: ["GET"],
      handler: async (_req, res) => {
        params.ensureEnabled();
        params.sendText(res, 200, params.readUiAsset("index.html"), html);
      },
    },
    {
      path: `${params.routeBase}/`,
      methods: ["GET"],
      handler: async (_req, res) => {
        params.ensureEnabled();
        params.sendText(res, 200, params.readUiAsset("index.html"), html);
      },
    },
    {
      path: `${params.routeBase}/index.html`,
      methods: ["GET"],
      handler: async (_req, res) => {
        params.ensureEnabled();
        params.sendText(res, 200, params.readUiAsset("index.html"), html);
      },
    },
    {
      path: `${params.routeBase}/app.js`,
      methods: ["GET"],
      handler: async (_req, res) => {
        params.ensureEnabled();
        params.sendText(res, 200, params.readUiAsset("app.js"), js);
      },
    },
    {
      path: `${params.routeBase}/chat`,
      methods: ["GET"],
      handler: async (_req, res) => {
        params.ensureEnabled();
        params.sendText(res, 200, params.readUiAsset("chat.html"), html);
      },
    },
    {
      path: `${params.routeBase}/chat.html`,
      methods: ["GET"],
      handler: async (_req, res) => {
        params.ensureEnabled();
        params.sendText(res, 200, params.readUiAsset("chat.html"), html);
      },
    },
    {
      path: `${params.routeBase}/chat.js`,
      methods: ["GET"],
      handler: async (_req, res) => {
        params.ensureEnabled();
        params.sendText(res, 200, params.readUiAsset("chat.js"), js);
      },
    },
    {
      path: `${params.routeBase}/openai-live.js`,
      methods: ["GET"],
      handler: async (_req, res) => {
        params.ensureEnabled();
        params.sendText(res, 200, params.readUiAsset("openai-live.js"), js);
      },
    },
    {
      path: `${params.routeBase}/gemini-live.js`,
      methods: ["GET"],
      handler: async (_req, res) => {
        params.ensureEnabled();
        params.sendText(res, 200, params.readUiAsset("gemini-live.js"), js);
      },
    },
    {
      path: `${params.routeBase}/trace`,
      methods: ["GET"],
      handler: async (_req, res) => {
        params.ensureEnabled();
        params.sendText(res, 200, params.readUiAsset("trace.html"), html);
      },
    },
    {
      path: `${params.routeBase}/trace.html`,
      methods: ["GET"],
      handler: async (_req, res) => {
        params.ensureEnabled();
        params.sendText(res, 200, params.readUiAsset("trace.html"), html);
      },
    },
    {
      path: `${params.routeBase}/trace.js`,
      methods: ["GET"],
      handler: async (_req, res) => {
        params.ensureEnabled();
        params.sendText(res, 200, params.readUiAsset("trace.js"), js);
      },
    },
    {
      path: `${params.routeBase}/session-log`,
      methods: ["GET"],
      handler: async (_req, res) => {
        params.ensureEnabled();
        params.sendText(res, 200, params.readUiAsset("session-log.html"), html);
      },
    },
    {
      path: `${params.routeBase}/session-log.html`,
      methods: ["GET"],
      handler: async (_req, res) => {
        params.ensureEnabled();
        params.sendText(res, 200, params.readUiAsset("session-log.html"), html);
      },
    },
    {
      path: `${params.routeBase}/session-log.js`,
      methods: ["GET"],
      handler: async (_req, res) => {
        params.ensureEnabled();
        params.sendText(res, 200, params.readUiAsset("session-log.js"), js);
      },
    },
    {
      path: `${params.routeBase}/style.css`,
      methods: ["GET"],
      handler: async (_req, res) => {
        params.ensureEnabled();
        params.sendText(res, 200, params.readUiAsset("style.css"), css);
      },
    },
  ];
}

export type { RouteDefinition };

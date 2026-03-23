import { type RouteDefinition } from "./static-routes.ts";

export function buildChatRoutes(params: {
  routeBase: string;
  api: any;
  config: { openaiVoice: string };
  ensureEnabled: () => void;
  requireAllowedOrigin: (req: any, config: any) => void;
  withCors: (req: any, res: any, config: any) => void;
  ensureTrustedBrowser: (req: any, config: any) => any;
  readJsonBody: (req: any) => Promise<Record<string, unknown>>;
  validateBodyString: (value: unknown, maxLength: number) => string;
  loadConversationStore: () => any;
  browserCanAccessConversation: (browserId: string, conversation: any) => boolean;
  resolvePrimaryAgentModelRef: (api: any) => string;
  resolveProviderApiKey: (api: any, provider: "openai") => Promise<string>;
  appendMessageToSessionTranscriptLocal: (params: {
    agentId: string;
    sessionKey: string;
    role: "user" | "assistant";
    text: string;
    idempotencyKey: string;
  }) => { ok: boolean; reason?: string; sessionFile?: string };
  updateConversationRecord: (params: {
    conversationId: string;
    mutate: (entry: any) => void;
  }) => any;
  summarizeText: (text: string, max?: number) => string;
  randomIdSuffix: () => string;
  runOpenAiTextTurn: (params: {
    api: any;
    conversation: { sessionKey: string };
    userText: string;
    model?: string;
    instructionsBase?: string;
    deps: any;
  }) => Promise<{ assistantText: string }>;
  transcribeOpenAiAudio: (params: {
    apiKey: string;
    audioBase64: string;
    mimeType: string;
    deps: { browserVoiceLog: (event: string, details?: Record<string, unknown>) => void; clipForLog: (value: string, max?: number) => string };
  }) => Promise<string>;
  synthesizeOpenAiSpeech: (params: {
    apiKey: string;
    text: string;
    voice: string;
    deps: { browserVoiceLog: (event: string, details?: Record<string, unknown>) => void };
  }) => Promise<{ audioBase64: string; mimeType: string }>;
  browserVoiceLog: (event: string, details?: Record<string, unknown>) => void;
  clipForLog: (value: string, max?: number) => string;
  buildOpenAiProviderDeps: (api: any) => any;
  sendJson: (res: any, statusCode: number, body: unknown) => void;
  agentId: string;
}): RouteDefinition[] {
  return [
    {
      path: `${params.routeBase}/api/chat/turn`,
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
        const mode = body.mode === "openai_stt_tts" ? "openai_stt_tts" : "openai_text";
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

        const instructionsBase =
          params.validateBodyString(body.instructions, 4000) ||
          "You are OpenClaw voice. Be concise, capable, and natural.";
        const chatModelRef = params.resolvePrimaryAgentModelRef(params.api);
        const [chatProvider, ...chatModelParts] = chatModelRef.split("/");
        const chatModel = chatModelParts.join("/");
        if (chatProvider !== "openai" || !chatModel) {
          params.sendJson(res, 400, {
            error: `Chat mode currently supports an OpenAI default model. OpenClaw is configured for ${chatModelRef}.`,
          });
          return;
        }
        const openAiApiKey = await params.resolveProviderApiKey(params.api, "openai");
        const voice = params.config.openaiVoice || "alloy";

        let userText = params.validateBodyString(body.text, 12000);
        if (mode === "openai_stt_tts") {
          const audioBase64 = params.validateBodyString(body.audioBase64, 8 * 1024 * 1024);
          const mimeType = params.validateBodyString(body.mimeType, 120) || "audio/webm";
          if (!audioBase64) {
            params.sendJson(res, 400, { error: "audioBase64 required for openai_stt_tts mode" });
            return;
          }
          userText = await params.transcribeOpenAiAudio({
            apiKey: openAiApiKey,
            audioBase64,
            mimeType,
            deps: {
              browserVoiceLog: params.browserVoiceLog,
              clipForLog: params.clipForLog,
            },
          });
        }

        if (!userText) {
          params.sendJson(res, 400, { error: "text required" });
          return;
        }

        const userEntryId = `user-${Date.now()}-${params.randomIdSuffix()}`;
        const userResult = params.appendMessageToSessionTranscriptLocal({
          agentId: params.agentId,
          sessionKey: conversation.sessionKey,
          role: "user",
          text: userText,
          idempotencyKey: `browser-chat:${conversationId}:${userEntryId}`,
        });
        if (!userResult.ok) {
          throw new Error(userResult.reason);
        }
        params.updateConversationRecord({
          conversationId,
          mutate(entry) {
            entry.provider = "openai";
            entry.sessionFile = userResult.sessionFile;
            entry.preview = params.summarizeText(userText || "");
            if (!entry.title || entry.title === `${entry.provider === "google" ? "Gemini" : "OpenAI"} conversation`) {
              entry.title = params.summarizeText(userText || "", 48) || entry.title;
            }
            entry.lastMessageAt = new Date().toISOString();
          },
        });

        const reply = await params.runOpenAiTextTurn({
          api: params.api,
          conversation,
          userText,
          model: chatModel,
          instructionsBase,
          deps: params.buildOpenAiProviderDeps(params.api),
        });
        const assistantText = params.summarizeText(reply.assistantText || "", 12000);
        if (!assistantText) {
          throw new Error("OpenAI returned no assistant text");
        }

        const assistantEntryId = `assistant-${Date.now()}-${params.randomIdSuffix()}`;
        const assistantResult = params.appendMessageToSessionTranscriptLocal({
          agentId: params.agentId,
          sessionKey: conversation.sessionKey,
          role: "assistant",
          text: assistantText,
          idempotencyKey: `browser-chat:${conversationId}:${assistantEntryId}`,
        });
        if (!assistantResult.ok) {
          throw new Error(assistantResult.reason);
        }
        params.updateConversationRecord({
          conversationId,
          mutate(entry) {
            entry.provider = "openai";
            entry.sessionFile = assistantResult.sessionFile;
            entry.preview = params.summarizeText(assistantText);
            if (!entry.title || entry.title === `${entry.provider === "google" ? "Gemini" : "OpenAI"} conversation`) {
              entry.title = params.summarizeText(userText || assistantText, 48) || entry.title;
            }
            entry.lastMessageAt = new Date().toISOString();
          },
        });

        let speech: { audioBase64: string; mimeType: string } | null = null;
        if (mode === "openai_stt_tts") {
          speech = await params.synthesizeOpenAiSpeech({
            apiKey: openAiApiKey,
            text: assistantText,
            voice,
            deps: {
              browserVoiceLog: params.browserVoiceLog,
            },
          });
        }

        params.sendJson(res, 200, {
          ok: true,
          conversationId,
          chatModel: chatModelRef,
          mode,
          userText,
          assistantText,
          speech,
        });
      },
    },
  ];
}

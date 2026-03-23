const GEMINI_GENAI_MODULE = "@google/genai";

type GeminiProviderDeps = {
  resolveProviderApiKey: (api: any, provider: "google") => Promise<string>;
  buildGeminiToolDefinition: () => any;
  buildToolInstructions: (api: any) => string;
  browserVoiceLog: (event: string, details?: Record<string, unknown>) => void;
};

export async function createGeminiEphemeralToken(params: {
  api: any;
  config: { geminiModel: string };
  deps: GeminiProviderDeps;
}) {
  const apiKey = await params.deps.resolveProviderApiKey(params.api, "google");
  const mod = await import(GEMINI_GENAI_MODULE);
  const GoogleGenAI = (mod as { GoogleGenAI?: new (params: { apiKey: string }) => any }).GoogleGenAI;
  if (!GoogleGenAI) {
    throw new Error("Gemini SDK not available");
  }

  const client = new GoogleGenAI({ apiKey });
  const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const tools = [params.deps.buildGeminiToolDefinition()];
  const systemInstruction = params.deps.buildToolInstructions(params.api);
  const liveConfig = {
    responseModalities: ["AUDIO"],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    ...(tools.length ? { tools } : {}),
    ...(systemInstruction
      ? {
          systemInstruction: {
            parts: [{ text: systemInstruction }],
          },
        }
      : {}),
  };

  const token = await client.authTokens.create({
    config: {
      uses: 1,
      expireTime,
      newSessionExpireTime,
      liveConnectConstraints: {
        model: params.config.geminiModel,
        config: liveConfig,
      },
      httpOptions: { apiVersion: "v1alpha" },
    },
  });

  params.deps.browserVoiceLog("gemini_bootstrap_response", {
    model: params.config.geminiModel,
    tokenName: typeof token?.name === "string" ? token.name : null,
    constrained: true,
  });

  return {
    provider: "google",
    model: params.config.geminiModel,
    token: token?.name ?? null,
    liveConfig,
    tools,
    systemInstruction,
  };
}

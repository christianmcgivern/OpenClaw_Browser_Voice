type ToolInvokeResult = {
  ok: boolean;
  result?: unknown;
  text: string;
};

type ConversationThreadEntry = {
  role: "user" | "assistant";
  text: string;
  synthetic: boolean;
};

type OpenAiProviderDeps = {
  resolveProviderApiKey: (api: any, provider: "openai") => Promise<string>;
  buildToolInstructions: (api: any) => string;
  buildOpenAiToolDefinition: () => any[];
  invokeOpenClawTool: (params: {
    api: any;
    sessionKey: string;
    tool: string;
    args: Record<string, unknown>;
  }) => Promise<ToolInvokeResult>;
  readConversationThread: (conversation: any, maxMessages?: number) => ConversationThreadEntry[];
  browserVoiceLog: (event: string, details?: Record<string, unknown>) => void;
  clipForLog: (value: string, max?: number) => string;
};

export const OPENAI_TEXT_MODEL = "gpt-4o-mini";
export const OPENAI_TRANSCRIBE_MODEL = "whisper-1";
export const OPENAI_TTS_MODEL = "tts-1";

function buildOpenAiChatToolDefinition(buildOpenAiToolDefinition: () => any[]) {
  return buildOpenAiToolDefinition().map((tool) => ({
    type: "function",
    function: {
      name: typeof tool.name === "string" ? tool.name : "",
      description: typeof tool.description === "string" ? tool.description : "",
      parameters: tool.parameters,
    },
  }));
}

function extractChatCompletionText(message: Record<string, any> | null | undefined) {
  if (!message) {
    return "";
  }
  if (typeof message.content === "string" && message.content.trim()) {
    return message.content.trim();
  }
  if (Array.isArray(message.content)) {
    return message.content
      .map((entry) => (entry && typeof entry === "object" && typeof entry.text === "string" ? entry.text.trim() : ""))
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

export async function createOpenAiClientSecret(params: {
  api: any;
  config: { openaiModel: string; openaiVoice: string };
  body: Record<string, unknown>;
  deps: OpenAiProviderDeps;
}) {
  const apiKey = await params.deps.resolveProviderApiKey(params.api, "openai");
  const instructionsBase =
    typeof params.body.instructions === "string" && params.body.instructions.trim()
      ? params.body.instructions.trim().slice(0, 4000)
      : "You are OpenClaw voice. Be concise, capable, and natural.";
  const instructions = `${instructionsBase}\n\n${params.deps.buildToolInstructions(params.api)}`;

  const payload = {
    session: {
      type: "realtime",
      model: params.config.openaiModel,
      instructions,
      output_modalities: ["audio"],
      tool_choice: "auto",
      tools: params.deps.buildOpenAiToolDefinition(),
      audio: {
        input: {
          transcription: {
            model: OPENAI_TRANSCRIBE_MODEL,
          },
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
            create_response: true,
            interrupt_response: true,
          },
        },
        output: {
          voice: params.config.openaiVoice,
        },
      },
    },
  };

  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  params.deps.browserVoiceLog("openai_bootstrap_response", {
    ok: response.ok,
    status: response.status,
    model: params.config.openaiModel,
    instructionsPreview: params.deps.clipForLog(instructions, 160),
    responsePreview: params.deps.clipForLog(text, 400),
  });
  if (!response.ok) {
    throw new Error(`OpenAI realtime bootstrap failed (${response.status}): ${text}`);
  }

  const parsed = text ? JSON.parse(text) : {};
  return {
    provider: "openai",
    model: params.config.openaiModel,
    session: parsed,
  };
}

export async function runOpenAiTextTurn(params: {
  api: any;
  conversation: { sessionKey: string };
  userText: string;
  model?: string;
  instructionsBase?: string;
  deps: OpenAiProviderDeps;
}) {
  const apiKey = await params.deps.resolveProviderApiKey(params.api, "openai");
  const prior = params.deps.readConversationThread(params.conversation, 24)
    .filter((entry) => !entry.synthetic)
    .map((entry) => ({
      role: entry.role,
      content: entry.text,
    }));
  const instructionsBase = params.instructionsBase?.trim() || "You are OpenClaw voice. Be concise, capable, and natural.";
  const messages: Array<Record<string, unknown>> = [
    {
      role: "system",
      content: `${instructionsBase}\n\n${params.deps.buildToolInstructions(params.api)}`,
    },
    ...prior,
    {
      role: "user",
      content: params.userText,
    },
  ];

  for (let iteration = 0; iteration < 8; iteration += 1) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: params.model || OPENAI_TEXT_MODEL,
        messages,
        tools: buildOpenAiChatToolDefinition(params.deps.buildOpenAiToolDefinition),
        tool_choice: "auto",
      }),
    });

    const text = await response.text();
    params.deps.browserVoiceLog("openai_chat_response", {
      ok: response.ok,
      status: response.status,
      model: params.model || OPENAI_TEXT_MODEL,
      responsePreview: params.deps.clipForLog(text, 400),
    });
    if (!response.ok) {
      throw new Error(`OpenAI chat failed (${response.status}): ${text}`);
    }

    const parsed = text ? JSON.parse(text) as Record<string, any> : {};
    const choice = Array.isArray(parsed.choices) ? parsed.choices[0] as Record<string, any> : null;
    const message = choice?.message && typeof choice.message === "object" ? choice.message as Record<string, any> : null;
    const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls as Array<Record<string, any>> : [];

    if (toolCalls.length) {
      messages.push({
        role: "assistant",
        content: extractChatCompletionText(message),
        tool_calls: toolCalls,
      });
      for (const call of toolCalls) {
        const fn = call.function && typeof call.function === "object" ? call.function as Record<string, any> : null;
        const name = typeof fn?.name === "string" ? fn.name : "";
        const rawArguments = typeof fn?.arguments === "string" ? fn.arguments : "";
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = rawArguments ? JSON.parse(rawArguments) : {};
        } catch {
          parsedArgs = {};
        }
        const tool = name === "write_file"
          ? "write_file"
          : typeof parsedArgs.tool === "string"
            ? parsedArgs.tool.trim()
            : "";
        const args = name === "write_file"
          ? {
              path: typeof parsedArgs.path === "string" ? parsedArgs.path : "",
              content: typeof parsedArgs.content === "string" ? parsedArgs.content : "",
            }
          : parsedArgs.args && typeof parsedArgs.args === "object" && !Array.isArray(parsedArgs.args)
            ? parsedArgs.args as Record<string, unknown>
            : {};
        const result = tool
          ? await params.deps.invokeOpenClawTool({
              api: params.api,
              sessionKey: params.conversation.sessionKey,
              tool,
              args,
            })
          : { ok: false, text: "Tool error: missing tool name" };
        messages.push({
          role: "tool",
          tool_call_id: typeof call.id === "string" ? call.id : "",
          content: JSON.stringify({
            ok: result.ok,
            text: result.text,
            result: result.result ?? null,
          }),
        });
      }
      continue;
    }

    return {
      assistantText: extractChatCompletionText(message),
      usage: parsed.usage ?? null,
      raw: parsed,
    };
  }

  throw new Error("OpenAI chat exceeded tool iteration limit");
}

export async function transcribeOpenAiAudio(params: {
  apiKey: string;
  audioBase64: string;
  mimeType?: string;
  deps: Pick<OpenAiProviderDeps, "browserVoiceLog" | "clipForLog">;
}) {
  const audioBuffer = Buffer.from(params.audioBase64, "base64");
  const form = new FormData();
  const mimeType = params.mimeType?.trim() || "audio/webm";
  const ext = mimeType.includes("mp4") ? "m4a" : mimeType.includes("mpeg") ? "mp3" : mimeType.includes("wav") ? "wav" : "webm";
  form.set("model", OPENAI_TRANSCRIBE_MODEL);
  form.set("response_format", "json");
  form.set("file", new Blob([audioBuffer], { type: mimeType }), `recording.${ext}`);

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: form,
  });
  const text = await response.text();
  params.deps.browserVoiceLog("openai_transcription_response", {
    ok: response.ok,
    status: response.status,
    model: OPENAI_TRANSCRIBE_MODEL,
    responsePreview: params.deps.clipForLog(text, 300),
  });
  if (!response.ok) {
    throw new Error(`OpenAI transcription failed (${response.status}): ${text}`);
  }
  const parsed = text ? JSON.parse(text) as Record<string, any> : {};
  const transcript = typeof parsed.text === "string" ? parsed.text.trim() : "";
  if (!transcript) {
    throw new Error("OpenAI transcription returned no text");
  }
  return transcript;
}

export async function summarizeOpenAiConversation(params: {
  apiKey: string;
  transcript: string;
  model: string;
  deps: Pick<OpenAiProviderDeps, "browserVoiceLog" | "clipForLog">;
}) {
  const systemPrompt = [
    "You summarize completed voice conversations for a browser client.",
    "Return exactly two sections in plain text.",
    "Line 1 must start with `Title:` followed by a short descriptive title under 80 characters.",
    "Line 2 must start with `Summary:` followed by a concise summary of 8 sentences or fewer.",
    "Preserve important user preferences, requests, outcomes, unresolved items, and factual context.",
    "Do not include markdown, bullet points, or extra labels.",
  ].join(" ");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model || OPENAI_TEXT_MODEL,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: `Summarize this conversation.\n\n${params.transcript}`,
        },
      ],
    }),
  });

  const text = await response.text();
  params.deps.browserVoiceLog("openai_summary_response", {
    ok: response.ok,
    status: response.status,
    model: params.model || OPENAI_TEXT_MODEL,
    responsePreview: params.deps.clipForLog(text, 500),
  });
  if (!response.ok) {
    throw new Error(`OpenAI summary failed (${response.status}): ${text}`);
  }

  const parsed = text ? JSON.parse(text) as Record<string, any> : {};
  const choice = Array.isArray(parsed.choices) ? parsed.choices[0] as Record<string, any> : null;
  const message = choice?.message && typeof choice.message === "object" ? choice.message as Record<string, any> : null;
  const raw = extractChatCompletionText(message);
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const titleLine = lines.find((line) => /^title:/i.test(line)) || "";
  const summaryLine = lines.find((line) => /^summary:/i.test(line)) || "";
  const title = titleLine.replace(/^title:\s*/i, "").trim();
  const summary = summaryLine.replace(/^summary:\s*/i, "").trim();

  if (!title || !summary) {
    throw new Error("OpenAI summary returned an unexpected format");
  }

  return {
    title,
    summary,
    raw,
  };
}

export async function synthesizeOpenAiSpeech(params: {
  apiKey: string;
  text: string;
  voice: string;
  deps: Pick<OpenAiProviderDeps, "browserVoiceLog">;
}) {
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_TTS_MODEL,
      voice: params.voice,
      input: params.text,
      format: "mp3",
    }),
  });
  const audioBuffer = Buffer.from(await response.arrayBuffer());
  params.deps.browserVoiceLog("openai_tts_response", {
    ok: response.ok,
    status: response.status,
    model: OPENAI_TTS_MODEL,
    bytes: audioBuffer.length,
  });
  if (!response.ok) {
    throw new Error(`OpenAI speech failed (${response.status})`);
  }
  return {
    audioBase64: audioBuffer.toString("base64"),
    mimeType: "audio/mpeg",
  };
}

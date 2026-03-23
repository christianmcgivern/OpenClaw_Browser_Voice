import type https from "node:https";
import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";

type TrustedBrowserRecord = {
  id: string;
  label?: string;
};

type ConversationRecord = {
  id: string;
  sessionKey: string;
  provider: "google" | "openai";
};

type GeminiBootstrap = {
  model: string;
  token: string | null;
  tools?: any[];
  systemInstruction?: string;
};

type GeminiLiveBridgeDeps = {
  resolveTrustedBrowser: (req: any) => TrustedBrowserRecord | null;
  getConversationForBrowser: (browserId: string, conversationId: string) => ConversationRecord | null;
  createBootstrap: () => Promise<GeminiBootstrap>;
  persistTranscript: (params: {
    conversationId: string;
    role: "user" | "assistant";
    text: string;
    entryId: string;
  }) => void;
  invokeTool: (params: {
    conversationId: string;
    sessionKey: string;
    tool: string;
    args: Record<string, unknown>;
  }) => Promise<{ ok: boolean; text: string; result?: unknown }>;
  browserVoiceLog: (event: string, details?: Record<string, unknown>) => void;
  routeBase: string;
};

function parseJson(data: unknown) {
  try {
    return JSON.parse(String(data || "{}")) as Record<string, any>;
  } catch {
    return null;
  }
}

function send(socket: WebSocket, payload: Record<string, unknown>) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function buildGeminiProviderWsUrl(token: string) {
  return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(token)}`;
}

function buildGeminiSetup(bootstrap: GeminiBootstrap, extraInstruction = "") {
  const instructionText = [bootstrap.systemInstruction, String(extraInstruction || "").trim()]
    .filter((value) => typeof value === "string" && value.trim())
    .join("\n\n");
  return {
    setup: {
      model: `models/${bootstrap.model}`,
      generationConfig: {
        responseModalities: ["AUDIO"],
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      ...(instructionText
        ? {
            systemInstruction: {
              parts: [{ text: instructionText }],
            },
          }
        : {}),
      ...(Array.isArray(bootstrap.tools) && bootstrap.tools.length
        ? { tools: bootstrap.tools }
        : {}),
    },
  };
}

function summarizeToolNames(tools: unknown) {
  return (Array.isArray(tools) ? tools : [])
    .flatMap((tool) => Array.isArray(tool?.functionDeclarations) ? tool.functionDeclarations : [])
    .map((decl) => (typeof decl?.name === "string" ? decl.name : ""))
    .filter(Boolean);
}

function extractTextFromParts(parts: unknown) {
  return (Array.isArray(parts) ? parts : [])
    .map((part) => (typeof part?.text === "string" ? part.text.trim() : ""))
    .filter(Boolean)
    .join(" ")
    .trim();
}

function mergeTranscriptChunk(currentText: string, nextText: string) {
  const current = String(currentText || "").trim();
  const next = String(nextText || "").trim();
  if (!next) {
    return current;
  }
  if (!current) {
    return next;
  }
  if (next.startsWith(current)) {
    return next;
  }
  if (current.endsWith(next)) {
    return current;
  }
  if (/^[,.;:!?)]/.test(next) || /[\s(/-]$/.test(current)) {
    return `${current}${next}`.trim();
  }
  return `${current} ${next}`.trim();
}

export function createGeminiLiveBridge(deps: GeminiLiveBridgeDeps) {
  const wss = new WebSocketServer({ noServer: true });
  const upgradePath = `${deps.routeBase}/ws/gemini-live`;

  wss.on("connection", (browserSocket: WebSocket, req: any) => {
    const browser = deps.resolveTrustedBrowser(req);
    if (!browser) {
      send(browserSocket, { type: "error", message: "Browser is not trusted." });
      browserSocket.close(4401, "not trusted");
      return;
    }

    let providerSocket: WebSocket | null = null;
    let conversation: ConversationRecord | null = null;
    let currentAssistantEntryId: string | null = null;
    let currentAssistantText = "";
    let currentUserEntryId: string | null = null;
    let started = false;
    let initialContextText = "";

    const closeProvider = () => {
      if (providerSocket && providerSocket.readyState < WebSocket.CLOSING) {
        providerSocket.close();
      }
      providerSocket = null;
    };

    const forwardProviderMessage = async (raw: unknown) => {
      const message = parseJson(raw);
      if (!message || !conversation) {
        return;
      }

      deps.browserVoiceLog("gemini_bridge_provider_message", {
        conversationId: conversation.id,
        hasSetupComplete: !!message.setupComplete,
        hasServerContent: !!message.serverContent,
        hasToolCall: !!message.toolCall,
        interrupted: !!message.serverContent?.interrupted,
        turnComplete: !!message.serverContent?.turnComplete,
      });

      if (message.setupComplete) {
        if (initialContextText && providerSocket?.readyState === WebSocket.OPEN) {
          deps.browserVoiceLog("gemini_bridge_initial_context_sent", {
            conversationId: conversation?.id ?? null,
            preview: initialContextText.slice(0, 220),
          });
          send(providerSocket, {
            clientContent: {
              turns: [
                {
                  role: "user",
                  parts: [{ text: initialContextText }],
                },
              ],
              turnComplete: true,
            },
          });
          initialContextText = "";
        }
        send(browserSocket, { type: "ready" });
        return;
      }

      if (message.serverContent?.inputTranscription?.text) {
        const text = String(message.serverContent.inputTranscription.text).trim();
        if (text) {
          currentUserEntryId ||= `gemini-user-${Date.now()}`;
          send(browserSocket, {
            type: "input_transcription",
            text,
            finished: !!message.serverContent.inputTranscription.finished,
          });
          if (message.serverContent.inputTranscription.finished) {
            deps.persistTranscript({
              conversationId: conversation.id,
              role: "user",
              text,
              entryId: currentUserEntryId,
            });
            currentUserEntryId = null;
          }
        }
      }

      const parts = Array.isArray(message.serverContent?.modelTurn?.parts)
        ? message.serverContent.modelTurn.parts
        : [];
      const outputText = String(message.serverContent?.outputTranscription?.text || "").trim() || extractTextFromParts(parts);
      if (outputText) {
        currentAssistantEntryId ||= `gemini-assistant-${Date.now()}`;
        currentAssistantText = mergeTranscriptChunk(currentAssistantText, outputText);
        send(browserSocket, {
          type: "output_text",
          text: currentAssistantText,
          finished: !!message.serverContent?.outputTranscription?.finished || !!message.serverContent?.turnComplete,
          entryId: currentAssistantEntryId,
        });
        if (message.serverContent?.outputTranscription?.finished || message.serverContent?.turnComplete) {
          deps.persistTranscript({
            conversationId: conversation.id,
            role: "assistant",
            text: currentAssistantText,
            entryId: currentAssistantEntryId,
          });
        }
      }

      for (const part of parts) {
        const inline = part?.inlineData;
        if (inline && typeof inline.data === "string" && /^audio\//i.test(String(inline.mimeType || ""))) {
          send(browserSocket, {
            type: "output_audio",
            data: inline.data,
            mimeType: inline.mimeType || "",
          });
        }
      }

      if (Array.isArray(message.toolCall?.functionCalls) && message.toolCall.functionCalls.length && conversation) {
        const functionResponses = [];
        for (const call of message.toolCall.functionCalls) {
          const name = typeof call?.name === "string" ? call.name : "";
          const parsedArgs = call?.args && typeof call.args === "object" && !Array.isArray(call.args)
            ? call.args
            : {};
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
              ? parsedArgs.args
              : {};
          const result = tool
            ? await deps.invokeTool({
                conversationId: conversation.id,
                sessionKey: conversation.sessionKey,
                tool,
                args,
              })
            : { ok: false, text: "Tool error: missing tool name" };
          functionResponses.push({
            id: typeof call?.id === "string" ? call.id : "",
            name,
            response: {
              output: {
                ok: result.ok,
                text: result.text,
                result: result.result ?? null,
              },
            },
          });
        }
        send(providerSocket!, {
          toolResponse: {
            functionResponses,
          },
        });
      }

      if (message.serverContent?.interrupted) {
        send(browserSocket, { type: "interrupted" });
      }

      if (message.serverContent?.turnComplete) {
        send(browserSocket, { type: "turn_complete" });
        currentAssistantEntryId = null;
        currentAssistantText = "";
      }
    };

    browserSocket.on("message", async (raw: unknown) => {
      const message = parseJson(raw);
      if (!message) {
        return;
      }

      if (message.type === "start") {
        if (started) {
          return;
        }
        const conversationId = typeof message.conversationId === "string" ? message.conversationId.trim() : "";
        const resolvedConversation = conversationId
          ? deps.getConversationForBrowser(browser.id, conversationId)
          : null;
        if (!resolvedConversation) {
          send(browserSocket, { type: "error", message: "Unknown or inaccessible conversation." });
          return;
        }
        conversation = resolvedConversation;
        started = true;
        try {
          const bootstrap = await deps.createBootstrap();
          const runtimeInstructions = typeof message.instructions === "string" ? message.instructions.trim() : "";
          initialContextText = runtimeInstructions;
          if (!bootstrap.token) {
            throw new Error("Gemini bootstrap missing token");
          }
          deps.browserVoiceLog("gemini_bridge_provider_setup", {
            conversationId: conversation.id,
            model: bootstrap.model,
            toolCount: Array.isArray(bootstrap.tools) ? bootstrap.tools.length : 0,
            toolNames: summarizeToolNames(bootstrap.tools),
            hasSystemInstruction: !!bootstrap.systemInstruction,
          });
          providerSocket = new WebSocket(buildGeminiProviderWsUrl(bootstrap.token));
          providerSocket.on("open", () => {
            send(providerSocket!, buildGeminiSetup(bootstrap, runtimeInstructions));
            send(browserSocket, { type: "provider_connecting", model: bootstrap.model });
          });
          providerSocket.on("message", (providerRaw: unknown) => {
            void forwardProviderMessage(providerRaw).catch((error) => {
              deps.browserVoiceLog("gemini_bridge_provider_message_error", {
                conversationId: conversation?.id ?? null,
                error: error instanceof Error ? error.message : String(error),
              });
              send(browserSocket, {
                type: "error",
                message: error instanceof Error ? error.message : String(error),
              });
            });
          });
          providerSocket.on("error", (error: Error) => {
            deps.browserVoiceLog("gemini_bridge_provider_error", {
              conversationId: conversation?.id ?? null,
              error: error?.message || "provider websocket error",
            });
            send(browserSocket, {
              type: "error",
              message: error?.message || "Gemini provider websocket error",
            });
          });
          providerSocket.on("close", () => {
            send(browserSocket, { type: "provider_closed" });
          });
        } catch (error) {
          deps.browserVoiceLog("gemini_bridge_start_error", {
            conversationId: conversation.id,
            error: error instanceof Error ? error.message : String(error),
          });
          send(browserSocket, {
            type: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }

      if (!providerSocket || providerSocket.readyState !== WebSocket.OPEN) {
        return;
      }

      if (message.type === "audio_chunk" && typeof message.audioBase64 === "string") {
        send(providerSocket, {
          realtimeInput: {
            audio: {
              mimeType: typeof message.mimeType === "string" ? message.mimeType : "audio/pcm;rate=16000",
              data: message.audioBase64,
            },
          },
        });
        return;
      }

      if (message.type === "audio_end") {
        send(providerSocket, {
          realtimeInput: {
            audioStreamEnd: true,
          },
        });
        return;
      }

      if (message.type === "close") {
        closeProvider();
        browserSocket.close(1000, "client closed");
      }
    });

    browserSocket.on("close", () => {
      closeProvider();
    });
  });

  return {
    attach(server: https.Server) {
      server.on("upgrade", (req: any, socket: any, head: any) => {
        try {
          const url = new URL(req.url || "/", "https://browser-voice.local");
          if (url.pathname !== upgradePath) {
            socket.destroy();
            return;
          }
          if (!deps.resolveTrustedBrowser(req)) {
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            socket.destroy();
            return;
          }
          wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit("connection", ws, req);
          });
        } catch {
          socket.destroy();
        }
      });
    },
    async stop() {
      for (const client of wss.clients) {
        try {
          client.close();
        } catch {
          // ignore client close failures
        }
      }
      await new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
    },
  };
}

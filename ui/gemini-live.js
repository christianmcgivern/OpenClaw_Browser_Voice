function safeError(error) {
  return error instanceof Error ? error.message : String(error || "unknown");
}

function parseSampleRate(mimeType) {
  const match = /rate=(\d+)/i.exec(String(mimeType || ""));
  const parsed = match ? Number.parseInt(match[1], 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 24000;
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

function pcm16ToFloat32(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(bytes.byteLength / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = view.getInt16(index * 2, true) / 0x8000;
  }
  return out;
}

function downsampleTo16k(samples, inputSampleRate) {
  if (!samples?.length) {
    return new Int16Array(0);
  }
  if (inputSampleRate === 16000) {
    const out = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i += 1) {
      const value = Math.max(-1, Math.min(1, samples[i]));
      out[i] = value < 0 ? value * 0x8000 : value * 0x7fff;
    }
    return out;
  }

  const ratio = inputSampleRate / 16000;
  const length = Math.max(1, Math.round(samples.length / ratio));
  const out = new Int16Array(length);
  let offsetResult = 0;
  let offsetBuffer = 0;

  while (offsetResult < out.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < samples.length; i += 1) {
      accum += samples[i];
      count += 1;
    }
    const value = count ? accum / count : 0;
    const clipped = Math.max(-1, Math.min(1, value));
    out[offsetResult] = clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff;
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }

  return out;
}

function buildBridgeUrl(apiBase) {
  const routeBase = String(apiBase || "").replace(/\/api$/, "");
  const url = new URL(`${routeBase}/ws/gemini-live`, window.location.href);
  url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export async function startGeminiLiveSession(ctx) {
  const trace = async (message, data, level = "info") => {
    ctx.log(message, data);
    await ctx.sendClientTrace(message, data, level);
  };

  await trace("gemini_bridge_start_begin", {
    secureContext: window.isSecureContext,
    hasMediaDevices: !!navigator.mediaDevices,
    hasGetUserMedia: !!navigator.mediaDevices?.getUserMedia,
  });

  const startPayload = await ctx.startConversation("google");
  const conversationId = startPayload?.conversationId;
  if (!conversationId) {
    throw new Error("Gemini bridge missing conversationId");
  }
  const conversationInstructions = typeof ctx.buildConversationContextPrompt === "function"
    ? await ctx.buildConversationContextPrompt()
    : "";
  await trace("gemini_bridge_conversation_started", {
    conversationId,
  });

  let ws = null;
  let media = null;
  let inputContext = null;
  let playbackContext = null;
  let source = null;
  let processor = null;
  let playbackTime = 0;
  let audioChunkCount = 0;
  let currentAssistantEntryId = null;
  let started = false;
  let readyTimer = null;

  const stopPlaybackQueue = () => {
    playbackTime = playbackContext ? playbackContext.currentTime : 0;
  };

  const playAudioChunk = async (base64, mimeType) => {
    if (!playbackContext || !base64) {
      return;
    }
    if (playbackContext.state === "suspended") {
      await playbackContext.resume();
    }
    const bytes = base64ToBytes(base64);
    const pcm = pcm16ToFloat32(bytes);
    const sampleRate = parseSampleRate(mimeType);
    const audioBuffer = playbackContext.createBuffer(1, pcm.length, sampleRate);
    audioBuffer.copyToChannel(pcm, 0);
    const sourceNode = playbackContext.createBufferSource();
    sourceNode.buffer = audioBuffer;
    sourceNode.connect(playbackContext.destination);
    playbackTime = Math.max(playbackTime, playbackContext.currentTime);
    sourceNode.start(playbackTime);
    playbackTime += audioBuffer.duration;
  };

  try {
    await trace("gemini_bridge_get_user_media_begin", {});
    media = await navigator.mediaDevices.getUserMedia({ audio: true });
    await trace("gemini_bridge_get_user_media_ok", {
      tracks: media.getAudioTracks().map((track) => ({
        label: track.label,
        enabled: track.enabled,
        muted: track.muted,
        readyState: track.readyState,
      })),
    });

    inputContext = new AudioContext();
    playbackContext = new AudioContext();
    playbackTime = playbackContext.currentTime;
    await trace("gemini_bridge_audio_contexts_ok", {
      inputSampleRate: inputContext.sampleRate,
      playbackSampleRate: playbackContext.sampleRate,
    });
  } catch (error) {
    await trace("gemini_bridge_start_error", {
      error: safeError(error),
      name: error instanceof Error ? error.name : undefined,
    }, "error");
    throw error;
  }

  ws = new WebSocket(buildBridgeUrl(ctx.apiBase));

  const readyPromise = new Promise((resolve, reject) => {
    readyTimer = window.setTimeout(() => {
      void trace("gemini_bridge_ready_timeout", {
        readyState: ws.readyState,
      }, "warn");
      reject(new Error("Gemini bridge timed out before becoming ready"));
    }, 10000);

    ws.addEventListener("open", () => {
      void trace("gemini_bridge_ws_open", {});
      ws.send(JSON.stringify({
        type: "start",
        conversationId,
        instructions: conversationInstructions,
      }));
    }, { once: true });

    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data || "{}"));
      void trace("gemini_bridge_message", {
        type: message.type || "unknown",
      }, "debug");

      if (message.type === "provider_connecting") {
        ctx.setStatus("Connecting", "Gemini bridge connected. Starting live session...");
      } else if (message.type === "ready") {
        if (readyTimer) {
          clearTimeout(readyTimer);
          readyTimer = null;
        }
        resolve(null);
      } else if (message.type === "input_transcription" && message.text) {
        ctx.setStatus("Listening...", "Gemini live session is active on this browser.");
      } else if (message.type === "output_text" && message.text) {
        const entryId = message.entryId || currentAssistantEntryId || `gemini-assistant-${Date.now()}`;
        currentAssistantEntryId = entryId;
        ctx.commitAssistantText(entryId, message.text);
      } else if (message.type === "output_audio" && message.data) {
        void playAudioChunk(message.data, message.mimeType || "").catch((error) => {
          void trace("gemini_bridge_playback_error", {
            error: safeError(error),
          }, "warn");
        });
      } else if (message.type === "interrupted") {
        stopPlaybackQueue();
      } else if (message.type === "turn_complete") {
        currentAssistantEntryId = null;
        ctx.setStatus("Ready", "Gemini live session is active on this browser.");
      } else if (message.type === "error") {
        reject(new Error(typeof message.message === "string" ? message.message : "Gemini bridge error"));
      }
    });

    ws.addEventListener("error", () => {
      void trace("gemini_bridge_ws_error", {
        readyState: ws.readyState,
      }, "error");
      if (readyTimer) {
        clearTimeout(readyTimer);
        readyTimer = null;
      }
      reject(new Error("Gemini bridge websocket failed"));
    }, { once: true });
    ws.addEventListener("close", (event) => {
      void trace("gemini_bridge_ws_close", {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      }, "warn");
      if (readyTimer) {
        clearTimeout(readyTimer);
        readyTimer = null;
      }
    });
  });

  await readyPromise;
  await trace("gemini_bridge_ready", {
    conversationId,
  });

  source = inputContext.createMediaStreamSource(media);
  processor = inputContext.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (event) => {
    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }
    const channelData = event.inputBuffer.getChannelData(0);
    const pcm16 = downsampleTo16k(channelData, inputContext.sampleRate);
    if (!pcm16.length) {
      return;
    }
    const bytes = new Uint8Array(pcm16.buffer);
    audioChunkCount += 1;
    if (audioChunkCount <= 3) {
      void trace("gemini_bridge_audio_chunk_sent", {
        chunk: audioChunkCount,
        samples: pcm16.length,
      }, "debug");
    }
    ws.send(JSON.stringify({
      type: "audio_chunk",
      mimeType: "audio/pcm;rate=16000",
      audioBase64: bytesToBase64(bytes),
    }));
  };
  source.connect(processor);
  processor.connect(inputContext.destination);
  started = true;

  ctx.setVoiceState(true);
  ctx.setStatus("Listening...", "Gemini live session is active on this browser.");
  ctx.log("gemini_bridge_connected", {
    conversationId,
  });

  return {
    ws,
    media,
    inputContext,
    playbackContext,
    source,
    processor,
    stop: async () => {
      if (ws.readyState === WebSocket.OPEN) {
        if (started) {
          ws.send(JSON.stringify({ type: "audio_end" }));
        }
        ws.send(JSON.stringify({ type: "close" }));
      }
      processor?.disconnect();
      source?.disconnect();
      media?.getTracks().forEach((track) => track.stop());
      ws.close();
      await inputContext?.close().catch(() => {});
      await playbackContext?.close().catch(() => {});
      await trace("gemini_bridge_stop_complete", {
        conversationId,
      }, "debug");
    },
  };
}

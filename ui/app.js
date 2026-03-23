const rootUrl = new URL(".", window.location.href);
const routeBase = rootUrl.pathname.replace(/\/$/, "");
const apiBase = `${routeBase}/api`;

const statusTextEl = document.getElementById("status-text");
const subStatusEl = document.getElementById("sub-status");
const voiceBarEl = document.getElementById("voice-bar");
const voiceButtonEl = document.getElementById("voice-button");
const whisperEndButtonEl = document.getElementById("whisper-end-button");
const whisperToolsEl = document.getElementById("whisper-tools");
const whisperReplayButtonEl = document.getElementById("whisper-replay-button");
const authButtonEl = document.getElementById("auth-button");
const continueButtonEl = document.getElementById("continue-button");
const newChatButtonEl = document.getElementById("new-chat-button");
const historyButtonEl = document.getElementById("history-button");
const providerInlineEl = document.getElementById("provider-inline");
const setupToggleEl = document.getElementById("setup-toggle");
const trustButtonEl = document.getElementById("trust-button");
const setupPanelEl = document.getElementById("setup-panel");
const historyShellEl = document.getElementById("history-shell");
const historySummaryEl = document.getElementById("history-summary");
const historySummarizeButtonEl = document.getElementById("history-summarize-button");
const historySearchEl = document.getElementById("history-search");
const historySearchButtonEl = document.getElementById("history-search-button");
const historyCurrentDeviceEl = document.getElementById("history-current-device");
const historyOtherDevicesEl = document.getElementById("history-other-devices");
const historySharedEl = document.getElementById("history-shared");
const responseShellEl = document.getElementById("response-shell");
const responseTextEl = document.getElementById("response-text");
const accessCodeEl = document.getElementById("access-code");
const instructionsEl = document.getElementById("instructions");
const remoteAudioEl = document.getElementById("remote-audio");
const debugToggleEl = document.getElementById("debug-toggle");
const debugDrawerEl = document.getElementById("debug-drawer");
const debugLogEl = document.getElementById("debug-log");
const debugRefreshEl = document.getElementById("debug-refresh");
const debugClearEl = document.getElementById("debug-clear");
const debugCloseEl = document.getElementById("debug-close");
const logVisibilityToggleEl = document.getElementById("log-visibility-toggle");
const themeSelectEl = document.getElementById("theme-select");

let openAiSession = null;
let geminiSession = null;
let geminiModulePromise = null;
let pluginStatus = null;
let isVoiceLive = false;
let activeConversationId = null;
let activeAssistantEntryId = null;
let activeAssistantText = "";
let pendingNewConversation = false;
let toolManifest = null;
const processedToolCalls = new Set();
let pendingRenderText = "";
let responseRenderTimer = null;
let sttTtsRecorder = null;
let sttTtsChunks = [];
let sttTtsStream = null;
let isTurnRecording = false;
let whisperSessionActive = false;
let speechPlaybackContext = null;
let speechPlaybackSource = null;
let lastSpeechPayload = null;
let conversationState = {
  currentConversationId: null,
  currentDevice: [],
  otherDevices: [],
  shared: [],
};
let selectedProvider = "openai";
const persistedTranscriptEntries = new Set();
const sessionLogStorageKey = "browser_voice_session_log";
const debugLogStorageKey = "browser_voice_debug_entries";
const debugVisibilityStorageKey = "browser_voice_debug_visible";
const debugEntries = [];
const maxDebugEntries = 250;
let touchStartY = 0;
const themeStorageKey = "browser_voice_theme";

function safeSerialize(value) {
  if (value instanceof Error) {
    return {
      message: value.message,
      stack: value.stack,
      name: value.name,
    };
  }
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return value;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function renderDebugLog() {
  if (!debugLogEl) {
    return;
  }
  if (!debugEntries.length) {
    debugLogEl.textContent = "No debug entries yet.";
    return;
  }
  debugLogEl.textContent = debugEntries
    .map((entry) => {
      const detail = entry.data === undefined ? "" : ` ${JSON.stringify(entry.data, null, 2)}`;
      return `[${entry.time}] ${entry.level.toUpperCase()} ${entry.message}${detail}`;
    })
    .join("\n\n");
  requestAnimationFrame(() => {
    debugLogEl.scrollTop = debugLogEl.scrollHeight;
  });
}

function persistDebugEntries() {
  try {
    window.sessionStorage.setItem(debugLogStorageKey, JSON.stringify(debugEntries));
  } catch {
    // best effort only
  }
}

function addDebugEntry(level, message, data) {
  debugEntries.push({
    time: new Date().toLocaleTimeString(),
    level,
    message: String(message),
    data: safeSerialize(data),
  });
  while (debugEntries.length > maxDebugEntries) {
    debugEntries.shift();
  }
  persistDebugEntries();
  renderDebugLog();
}

function loadPersistedDebugEntries() {
  try {
    const raw = window.sessionStorage.getItem(debugLogStorageKey);
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return;
    }
    debugEntries.splice(0, debugEntries.length, ...parsed.slice(-maxDebugEntries));
  } catch {
    // ignore storage parse issues
  }
}

function setDebugDrawerOpen(open) {
  if (!debugDrawerEl) {
    return;
  }
  debugDrawerEl.hidden = !open;
  if (debugToggleEl) {
    debugToggleEl.textContent = open ? "Hide Logs" : "Logs";
  }
  if (open) {
    renderDebugLog();
  }
  syncPanelStateButtons();
}

function syncPanelStateButtons() {
  setupToggleEl?.classList.toggle("is-active", !setupPanelEl?.hidden);
  historyButtonEl?.classList.toggle("is-active", !historyShellEl?.hidden);
  debugToggleEl?.classList.toggle("is-active", !debugDrawerEl?.hidden);
}

function currentTheme() {
  const value = window.localStorage.getItem(themeStorageKey) || "coast";
  return value === "studio" ? "studio" : "coast";
}

function applyTheme(theme) {
  const nextTheme = theme === "studio" ? "studio" : "coast";
  document.body.dataset.theme = nextTheme;
  window.localStorage.setItem(themeStorageKey, nextTheme);
  if (themeSelectEl) {
    themeSelectEl.value = nextTheme;
  }
}

function isDebugToggleVisible() {
  return window.localStorage.getItem(debugVisibilityStorageKey) !== "off";
}

function syncDebugVisibilityUi() {
  const visible = isDebugToggleVisible();
  if (debugToggleEl) {
    debugToggleEl.hidden = !visible;
  }
  if (!visible) {
    setDebugDrawerOpen(false);
  }
  if (logVisibilityToggleEl) {
    logVisibilityToggleEl.textContent = `Log Display: ${visible ? "On" : "Off"}`;
  }
}

function log(message, data) {
  const line = data === undefined
    ? String(message)
    : `${String(message)} ${JSON.stringify(data, null, 2)}`;
  addDebugEntry("info", message, data);
  const current = window.sessionStorage.getItem(sessionLogStorageKey) || "";
  window.sessionStorage.setItem(
    sessionLogStorageKey,
    `${new Date().toLocaleTimeString()} ${line}\n${current}`.trim(),
  );
  void sendClientTrace("browser_session_log", {
    line,
  }, "debug");
}

function safeTraceError(error) {
  return error instanceof Error ? error.message : String(error || "unknown");
}

function base64ToObjectUrl(base64, mimeType) {
  const binary = atob(String(base64 || ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const blob = new Blob([bytes], { type: mimeType || "audio/mpeg" });
  return URL.createObjectURL(blob);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(String(base64 || ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

async function ensureSpeechPlaybackContext() {
  log("speech_context_check", {
    hasContext: !!speechPlaybackContext,
    hasAudioContext: !!(window.AudioContext || window.webkitAudioContext),
  });
  if (!speechPlaybackContext) {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      log("speech_context_unavailable");
      return null;
    }
    speechPlaybackContext = new AudioContextCtor();
    log("speech_context_created", {
      state: speechPlaybackContext.state,
      sampleRate: speechPlaybackContext.sampleRate,
    });
  }
  if (speechPlaybackContext.state === "suspended") {
    log("speech_context_resume_begin", {
      state: speechPlaybackContext.state,
    });
    await speechPlaybackContext.resume();
    log("speech_context_resume_done", {
      state: speechPlaybackContext.state,
    });
  }
  return speechPlaybackContext;
}

async function playSpeechAudio(base64, mimeType) {
  lastSpeechPayload = {
    base64,
    mimeType: mimeType || "audio/mpeg",
  };
  log("speech_play_begin", {
    mimeType: mimeType || "audio/mpeg",
    base64Length: String(base64 || "").length,
  });
  const context = await ensureSpeechPlaybackContext();
  if (!context) {
    log("speech_play_fallback_media_element", {
      reason: "no_audio_context",
    });
    const objectUrl = base64ToObjectUrl(base64, mimeType);
    replaceAudioSource(remoteAudioEl, objectUrl);
    await remoteAudioEl.play();
    log("speech_media_element_play_called", {});
    return;
  }

  try {
    log("speech_decode_begin", {
      contextState: context.state,
    });
    const audioBuffer = await context.decodeAudioData(base64ToArrayBuffer(base64).slice(0));
    log("speech_decode_success", {
      duration: audioBuffer.duration,
      sampleRate: audioBuffer.sampleRate,
      channels: audioBuffer.numberOfChannels,
    });
    if (speechPlaybackSource) {
      try {
        speechPlaybackSource.stop();
      } catch {
        // ignore stop race
      }
    }
    const source = context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(context.destination);
    source.onended = () => {
      log("speech_source_ended", {});
      if (speechPlaybackSource === source) {
        speechPlaybackSource = null;
      }
    };
    speechPlaybackSource = source;
    source.start();
    log("speech_source_started", {
      contextState: context.state,
    });
    return;
  } catch (error) {
    log("stt_tts_decode_error", {
      error: safeTraceError(error),
      mimeType,
    });
  }

  const objectUrl = base64ToObjectUrl(base64, mimeType);
  replaceAudioSource(remoteAudioEl, objectUrl);
  log("speech_play_fallback_media_element", {
    reason: "decode_failed",
  });
  await remoteAudioEl.play();
  log("speech_media_element_play_called", {});
}

function replaceAudioSource(audioEl, nextUrl) {
  const previousUrl = audioEl.dataset.objectUrl;
  if (previousUrl) {
    URL.revokeObjectURL(previousUrl);
  }
  audioEl.dataset.objectUrl = nextUrl || "";
  if (nextUrl) {
    audioEl.srcObject = null;
    audioEl.src = nextUrl;
    audioEl.load();
  } else {
    audioEl.removeAttribute("src");
    audioEl.load();
  }
}

async function sendClientTrace(message, data, level = "info") {
  addDebugEntry(level, message, data);
  try {
    await fetch(`${apiBase}/client-log`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        level,
        message,
        conversationId: activeConversationId,
        data,
      }),
    });
  } catch {
    // avoid recursive client logging failures
  }
}

function sendOpenAiClientEvent(event, traceMessage) {
  if (!openAiSession?.dataChannel || openAiSession.dataChannel.readyState !== "open") {
    throw new Error("OpenAI data channel is not ready");
  }
  openAiSession.dataChannel.send(JSON.stringify(event));
  void sendClientTrace(traceMessage || "openai_client_event_sent", {
    type: event.type,
    event,
  });
}

function setVoiceState(live) {
  isVoiceLive = live;
  voiceBarEl.classList.toggle("is-live", live || isTurnRecording);
  voiceButtonEl.classList.toggle("is-ready", !live && !isTurnRecording);
  voiceButtonEl.classList.toggle("is-live", live || isTurnRecording);
  if (selectedProvider !== "openai_stt_tts") {
    voiceButtonEl.querySelector(".voice-button-icon").textContent = live || isTurnRecording ? "■" : "●";
  }
  if (live) {
    setStatus("Listening...", "Live voice session is active on this browser.");
  }
  syncWhisperUi();
}

function setTurnRecordingState(recording) {
  isTurnRecording = recording;
  voiceBarEl.classList.toggle("is-live", isVoiceLive || recording);
  voiceButtonEl.classList.toggle("is-ready", !isVoiceLive && !recording);
  voiceButtonEl.classList.toggle("is-live", isVoiceLive || recording);
  if (selectedProvider !== "openai_stt_tts") {
    voiceButtonEl.querySelector(".voice-button-icon").textContent = isVoiceLive || recording ? "■" : "●";
  }
  syncWhisperUi();
}

function setStatus(title, detail) {
  statusTextEl.textContent = title;
  subStatusEl.textContent = detail;
}

remoteAudioEl.addEventListener("play", () => {
  log("speech_media_element_event", { type: "play" });
});
remoteAudioEl.addEventListener("playing", () => {
  log("speech_media_element_event", { type: "playing" });
});
remoteAudioEl.addEventListener("pause", () => {
  log("speech_media_element_event", { type: "pause" });
});
remoteAudioEl.addEventListener("ended", () => {
  log("speech_media_element_event", { type: "ended" });
});
remoteAudioEl.addEventListener("error", () => {
  log("speech_media_element_event", {
    type: "error",
    code: remoteAudioEl.error?.code || null,
    message: remoteAudioEl.error?.message || null,
  });
});

function formatDisplayText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

function showTranscript(text, append = true) {
  const wasHidden = responseShellEl.hidden;
  responseShellEl.hidden = false;
  const nextText = append ? `${responseTextEl.textContent}${text}` : text;
  responseTextEl.textContent = formatDisplayText(nextText);
  if (wasHidden) {
    responseShellEl.classList.remove("is-visible");
    requestAnimationFrame(() => {
      responseShellEl.classList.add("is-visible");
    });
  }
  requestAnimationFrame(() => {
    responseTextEl.scrollTo({
      top: responseTextEl.scrollHeight,
      behavior: "smooth",
    });
  });
}

voiceButtonEl.classList.add("is-ready");

function scheduleResponseRender() {
  if (responseRenderTimer) {
    return;
  }
  responseRenderTimer = window.setTimeout(() => {
    responseRenderTimer = null;
    if (!pendingRenderText) {
      return;
    }

    let chunk = pendingRenderText;
    if (pendingRenderText.length > 26) {
      const slice = pendingRenderText.slice(0, 26);
      const lastBoundary = Math.max(
        slice.lastIndexOf(" "),
        slice.lastIndexOf("\n"),
      );
      if (lastBoundary > 8) {
        chunk = pendingRenderText.slice(0, lastBoundary + 1);
      } else {
        chunk = pendingRenderText.slice(0, 26);
      }
    }

    pendingRenderText = pendingRenderText.slice(chunk.length);
    showTranscript(chunk, true);
    if (pendingRenderText) {
      scheduleResponseRender();
    }
  }, 70);
}

async function refreshToolManifest() {
  if (!pluginStatus?.authenticated) {
    toolManifest = null;
    return;
  }
  toolManifest = await jsonFetch(`${apiBase}/tools/manifest`, {
    method: "GET",
    headers: {},
  });
}

async function startConversation(provider) {
  const payload = await jsonFetch(`${apiBase}/session/start`, {
    method: "POST",
    body: JSON.stringify({
      provider,
      ...(activeConversationId ? { conversationId: activeConversationId } : {}),
      ...(pendingNewConversation ? { forceNew: true } : {}),
    }),
  });
  activeConversationId = payload.conversationId;
  pendingNewConversation = false;
  activeAssistantEntryId = null;
  activeAssistantText = "";
  pendingRenderText = "";
  if (responseRenderTimer) {
    clearTimeout(responseRenderTimer);
    responseRenderTimer = null;
  }
  persistedTranscriptEntries.clear();
  processedToolCalls.clear();
  await refreshConversations();
  return payload;
}

async function endConversation(provider) {
  if (!activeConversationId) {
    return;
  }
  await jsonFetch(`${apiBase}/session/end`, {
    method: "POST",
    body: JSON.stringify({
      provider,
      conversationId: activeConversationId,
    }),
  });
  activeConversationId = null;
  activeAssistantEntryId = null;
  activeAssistantText = "";
  pendingRenderText = "";
  if (responseRenderTimer) {
    clearTimeout(responseRenderTimer);
    responseRenderTimer = null;
  }
  persistedTranscriptEntries.clear();
  processedToolCalls.clear();
  await refreshConversations();
}

async function persistTranscript(role, text, entryId) {
  const formatted = formatDisplayText(text);
  if (!activeConversationId || !formatted || !entryId || persistedTranscriptEntries.has(entryId)) {
    return;
  }
  await jsonFetch(`${apiBase}/session/transcript`, {
    method: "POST",
    body: JSON.stringify({
      role,
      text: formatted,
      conversationId: activeConversationId,
      entryId,
    }),
  });
  persistedTranscriptEntries.add(entryId);
}

function beginAssistantResponse(entryId) {
  activeAssistantEntryId = entryId || `assistant-${Date.now()}`;
  activeAssistantText = "";
  pendingRenderText = "";
  if (responseRenderTimer) {
    clearTimeout(responseRenderTimer);
    responseRenderTimer = null;
  }
  showTranscript("", false);
}

function appendAssistantChunk(entryId, chunk) {
  if (!activeAssistantEntryId || activeAssistantEntryId !== entryId) {
    beginAssistantResponse(entryId);
  }
  const nextChunk = String(chunk || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n");

  if (
    activeAssistantText &&
    nextChunk &&
    !/^[\s,.;:!?)]/.test(nextChunk) &&
    !/[\s(/-]$/.test(activeAssistantText)
  ) {
    activeAssistantText += " ";
  }

  activeAssistantText += nextChunk;
  pendingRenderText += nextChunk;
  scheduleResponseRender();
}

function commitAssistantText(entryId, text) {
  const formatted = formatDisplayText(text);
  if (!formatted) {
    return;
  }
  if (!activeAssistantEntryId || activeAssistantEntryId !== entryId) {
    beginAssistantResponse(entryId);
  }
  activeAssistantEntryId = entryId;
  activeAssistantText = formatted;
  pendingRenderText = "";
  if (responseRenderTimer) {
    clearTimeout(responseRenderTimer);
    responseRenderTimer = null;
  }
  showTranscript(formatted, false);
}

async function jsonFetch(path, init) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    ...init,
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    const message = payload && typeof payload.error === "string"
      ? payload.error
      : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

function renderStatus(payload) {
  pluginStatus = payload;
  if (!providerInlineEl?.value) {
    selectedProvider = payload.defaultProvider || selectedProvider || "openai";
  }
  syncProviderUi();

  if (!payload.authenticated) {
    setStatus("Ready", "Authenticate this browser to begin.");
    authButtonEl.textContent = "Authenticate";
    return;
  }

  authButtonEl.textContent = "Authenticated";
  if (!activeConversationId && payload.currentConversationId) {
    activeConversationId = payload.currentConversationId;
  }
  if (!isVoiceLive) {
    const copy = providerStateCopy(selectedProvider);
    setStatus(copy.title, copy.detail);
  }
}

function providerLabel(value) {
  if (value === "google") return "Gemini Live";
  if (value === "openai_stt_tts") return "OpenAI Whisper";
  return "OpenAI Realtime";
}

function providerStateCopy(value) {
  if (value === "google") {
    return {
      title: "Ready",
      detail: "Gemini Live is selected for this browser.",
    };
  }
  if (value === "openai_stt_tts") {
    return {
      title: "Ready",
      detail: "OpenAI Whisper is selected for turn-based voice replies.",
    };
  }
  return {
    title: "Ready",
    detail: "OpenAI Realtime is selected for live voice.",
  };
}

function syncProviderUi() {
  if (providerInlineEl) {
    providerInlineEl.value = selectedProvider;
  }
  syncWhisperUi();
}

function syncWhisperUi() {
  const whisperMode = selectedProvider === "openai_stt_tts";
  const active = whisperMode && whisperSessionActive;
  if (whisperEndButtonEl) {
    whisperEndButtonEl.hidden = !active;
    whisperEndButtonEl.classList.toggle("is-live", active);
  }
  if (whisperToolsEl) {
    whisperToolsEl.hidden = !active;
  }
  if (!whisperMode) {
    voiceButtonEl.querySelector(".voice-button-icon").textContent = isVoiceLive || isTurnRecording ? "■" : "●";
    voiceButtonEl.setAttribute("aria-label", "Start voice session");
    return;
  }
  if (!active) {
    voiceButtonEl.querySelector(".voice-button-icon").textContent = "▶";
    voiceButtonEl.setAttribute("aria-label", "Start Whisper session");
    return;
  }
  voiceButtonEl.querySelector(".voice-button-icon").textContent = isTurnRecording ? "■" : "●";
  voiceButtonEl.setAttribute("aria-label", isTurnRecording ? "Tap to send Whisper turn" : "Tap to record Whisper turn");
}

function buildVoiceRuntimeContext() {
  return {
    apiBase,
    jsonFetch,
    startConversation,
    fetchConversationThread,
    buildConversationContextPrompt,
    setVoiceState,
    setStatus,
    log,
    sendClientTrace,
    persistTranscript,
    appendAssistantChunk,
    commitAssistantText,
    invokeBrowserTool,
    showTranscript,
    addDebugEntry,
  };
}

async function loadGeminiModule() {
  if (!geminiModulePromise) {
    geminiModulePromise = import("./gemini-live.js");
  }
  return geminiModulePromise;
}

function formatTimestamp(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function renderConversationList(target, items, emptyLabel) {
  target.textContent = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = emptyLabel;
    target.appendChild(empty);
    return;
  }

  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `history-item${item.id === activeConversationId ? " is-active" : ""}`;
    button.innerHTML = `
      <div class="history-item-title">${item.title || "Conversation"}</div>
      <div class="history-item-meta">${item.provider === "google" ? "Gemini" : "OpenAI"} • ${item.mode === "shared" ? "Shared" : "Device"} • ${formatTimestamp(item.updatedAt)}</div>
      <div class="history-item-preview">${item.preview || "No saved response yet."}</div>
    `;
    button.addEventListener("click", () => {
      activeConversationId = item.id;
      pendingNewConversation = false;
      historySummaryEl.textContent = `Selected: ${item.title || "Conversation"}`;
      void loadSelectedConversationPreview().catch((error) => {
        log("conversation_preview_error", { error: error.message });
      });
      setStatus("Ready", `Selected ${item.title || "conversation"} for this device.`);
      renderHistory(conversationState);
    });
    target.appendChild(button);
  }
}

function renderHistory(payload) {
  conversationState = payload;
  historySummaryEl.textContent = payload.currentConversationId
    ? `Current conversation ready to continue.`
    : "No recent conversation on this device.";
  if (historySummarizeButtonEl) {
    historySummarizeButtonEl.disabled = !activeConversationId;
  }
  renderConversationList(historyCurrentDeviceEl, payload.currentDevice || [], "No device-local conversations yet.");
  renderConversationList(historyOtherDevicesEl, payload.otherDevices || [], "No conversations from other devices yet.");
  renderConversationList(historySharedEl, payload.shared || [], "No shared conversations yet.");
}

async function refreshConversations() {
  if (!pluginStatus?.authenticated) {
    return;
  }
  const payload = await jsonFetch(`${apiBase}/conversations`, {
    method: "GET",
    headers: {},
  });
  if (!activeConversationId && payload.currentConversationId) {
    activeConversationId = payload.currentConversationId;
  }
  renderHistory(payload);
}

async function fetchConversationThread(conversationId = activeConversationId) {
  if (!conversationId || !pluginStatus?.authenticated) {
    return [];
  }
  const payload = await jsonFetch(`${apiBase}/conversations/thread?conversationId=${encodeURIComponent(conversationId)}`, {
    method: "GET",
    headers: {},
  });
  return Array.isArray(payload.messages) ? payload.messages : [];
}

function buildConversationPreview(messages) {
  return (messages || [])
    .map((message) => {
      const role = message.role === "assistant" ? "Assistant" : "You";
      const text = formatDisplayText(message.text || "");
      return text ? `${role}: ${text}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function findConversationMetadata(conversationId = activeConversationId) {
  const pools = [
    conversationState.currentDevice || [],
    conversationState.otherDevices || [],
    conversationState.shared || [],
  ];
  for (const pool of pools) {
    const match = pool.find((entry) => entry.id === conversationId);
    if (match) {
      return match;
    }
  }
  return null;
}

async function loadSelectedConversationPreview() {
  if (!activeConversationId || !pluginStatus?.authenticated) {
    responseTextEl.textContent = "";
    responseShellEl.hidden = true;
    return;
  }
  const messages = await fetchConversationThread(activeConversationId);
  const preview = buildConversationPreview(messages);
  if (!preview) {
    responseTextEl.textContent = "";
    responseShellEl.hidden = true;
    return;
  }
  showTranscript(preview, false);
}

async function summarizeSelectedConversation() {
  if (!activeConversationId) {
    setStatus("Ready", "Select a conversation first.");
    return;
  }
  setStatus("Summarizing", "Building a compact summary for this conversation...");
  const payload = await jsonFetch(`${apiBase}/conversations/summarize`, {
    method: "POST",
    body: JSON.stringify({
      conversationId: activeConversationId,
    }),
  });
  await refreshConversations();
  await loadSelectedConversationPreview();
  setStatus("Ready", `Summary updated for ${payload.title || "this conversation"}.`);
}

async function buildConversationContextPrompt() {
  const baseInstructions = instructionsEl.value.trim();
  const metadata = findConversationMetadata(activeConversationId);
  const messages = await fetchConversationThread(activeConversationId);
  const summary = typeof metadata?.summary === "string" ? metadata.summary.trim() : "";
  if (!messages.length && !summary) {
    return baseInstructions;
  }
  const recentContext = buildConversationPreview(messages.slice(-10));
  const sections = [];
  if (summary) {
    sections.push(`Conversation summary:\n${summary}`);
  }
  if (recentContext) {
    sections.push(`Recent turns:\n${recentContext}`);
  }
  if (!sections.length) {
    return baseInstructions;
  }
  return `${baseInstructions}\n\nContinue this existing conversation naturally.\n\n${sections.join("\n\n")}`.slice(0, 12000);
}

async function searchConversations() {
  if (!pluginStatus?.authenticated) {
    return;
  }
  const query = historySearchEl.value.trim();
  if (!query) {
    await refreshConversations();
    return;
  }
  const payload = await jsonFetch(`${apiBase}/conversations/search`, {
    method: "POST",
    body: JSON.stringify({ query }),
  });
  renderHistory({
    currentConversationId: conversationState.currentConversationId,
    currentDevice: payload.results || [],
    otherDevices: [],
    shared: [],
  });
}

async function refreshStatus() {
  try {
    const payload = await jsonFetch(`${apiBase}/status`, {
      method: "GET",
      headers: {},
    });
    renderStatus(payload);
    log("status", payload);
    if (payload.authenticated) {
      await refreshToolManifest();
      await refreshConversations();
      await loadSelectedConversationPreview();
    }
  } catch (error) {
    setStatus("Unavailable", error.message);
    log("status_error", { error: error.message });
  }
}

function wireDebugDrawer() {
  loadPersistedDebugEntries();
  renderDebugLog();
  applyTheme(currentTheme());
  syncDebugVisibilityUi();
  syncPanelStateButtons();

  debugToggleEl?.addEventListener("click", () => {
    setDebugDrawerOpen(Boolean(debugDrawerEl?.hidden));
  });
  debugCloseEl?.addEventListener("click", () => {
    setDebugDrawerOpen(false);
  });
  debugRefreshEl?.addEventListener("click", () => {
    renderDebugLog();
    void sendClientTrace("debug_drawer_refresh", {
      entries: debugEntries.length,
    }, "debug");
  });
  debugClearEl?.addEventListener("click", () => {
    debugEntries.splice(0, debugEntries.length);
    persistDebugEntries();
    renderDebugLog();
    window.sessionStorage.removeItem(sessionLogStorageKey);
    void sendClientTrace("debug_drawer_cleared", {}, "debug");
  });

  logVisibilityToggleEl?.addEventListener("click", () => {
    const nextValue = isDebugToggleVisible() ? "off" : "on";
    window.localStorage.setItem(debugVisibilityStorageKey, nextValue);
    syncDebugVisibilityUi();
    void sendClientTrace("debug_visibility_changed", {
      visible: nextValue === "on",
    }, "debug");
  });

  themeSelectEl?.addEventListener("change", () => {
    applyTheme(themeSelectEl.value);
    void sendClientTrace("theme_changed", {
      theme: currentTheme(),
    }, "debug");
  });

  window.addEventListener("error", (event) => {
    addDebugEntry("error", "window_error", {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
    void sendClientTrace("window_error", {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    }, "error");
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason instanceof Error
      ? { message: event.reason.message, stack: event.reason.stack }
      : safeSerialize(event.reason);
    addDebugEntry("error", "unhandled_rejection", reason);
    void sendClientTrace("unhandled_rejection", reason, "error");
  });

  const originalWarn = console.warn.bind(console);
  console.warn = (...args) => {
    addDebugEntry("warn", "console.warn", args.map((arg) => safeSerialize(arg)));
    originalWarn(...args);
  };

  const originalError = console.error.bind(console);
  console.error = (...args) => {
    addDebugEntry("error", "console.error", args.map((arg) => safeSerialize(arg)));
    originalError(...args);
  };
}

function disablePullToRefresh() {
  const scrollRoot = document.querySelector(".shell");
  if (!scrollRoot) {
    return;
  }

  scrollRoot.addEventListener("touchstart", (event) => {
    touchStartY = event.touches?.[0]?.clientY ?? 0;
  }, { passive: true });

  scrollRoot.addEventListener("touchmove", (event) => {
    const currentY = event.touches?.[0]?.clientY ?? 0;
    const movingDown = currentY > touchStartY;
    if (movingDown && scrollRoot.scrollTop <= 0) {
      event.preventDefault();
    }
  }, { passive: false });
}

async function authenticateBrowser() {
  const accessCode = accessCodeEl.value.trim();
  if (!accessCode) {
    throw new Error("Access code required");
  }
  setStatus("Authenticating", "Establishing trusted browser session...");
  const payload = await jsonFetch(`${apiBase}/session/login`, {
    method: "POST",
    body: JSON.stringify({
      accessCode,
      label: navigator.userAgent,
    }),
  });
  log("browser_authenticated");
  await refreshStatus();
}

async function invokeBrowserTool(call) {
  if (!activeConversationId) {
    return { ok: false, text: "Tool error: no active conversation" };
  }
  await sendClientTrace("browser_tool_invoke_begin", {
    tool: call.tool,
    hasArgs: !!call.args && Object.keys(call.args).length > 0,
  });
  const payload = await jsonFetch(`${apiBase}/tools/invoke`, {
    method: "POST",
    body: JSON.stringify({
      conversationId: activeConversationId,
      tool: call.tool,
      args: call.args || {},
    }),
  });
  await sendClientTrace("browser_tool_invoke_result", {
    tool: call.tool,
    ok: payload.ok,
    text: payload.text,
  });
  return payload;
}

async function sendOpenAiToolResult(callId, result) {
  if (!openAiSession?.dataChannel || openAiSession.dataChannel.readyState !== "open") {
    throw new Error("OpenAI data channel is not ready");
  }
  openAiSession.dataChannel.send(JSON.stringify({
    type: "conversation.item.create",
    item: {
      type: "function_call_output",
      call_id: callId,
      output: JSON.stringify({
        ok: result.ok,
        text: result.text,
        result: result.result ?? null,
      }),
    },
  }));
  openAiSession.dataChannel.send(JSON.stringify({ type: "response.create" }));
}

async function handleOpenAiToolCall(callId, name, rawArguments) {
  if (!callId || processedToolCalls.has(callId)) {
    return;
  }
  processedToolCalls.add(callId);
  await sendClientTrace("openai_tool_call_received", {
    callId,
    name,
  });
  if (name !== "openclaw_tool" && name !== "write_file") {
    await sendOpenAiToolResult(callId, {
      ok: false,
      text: `Tool error: unsupported function ${name}`,
    });
    return;
  }

  let parsed = {};
  try {
    parsed = rawArguments ? JSON.parse(rawArguments) : {};
  } catch {
    await sendOpenAiToolResult(callId, {
      ok: false,
      text: "Tool error: could not parse tool arguments",
    });
    return;
  }

  const tool = name === "write_file"
    ? "write_file"
    : typeof parsed.tool === "string"
      ? parsed.tool.trim()
      : "";
  const args = name === "write_file"
    ? {
        path: typeof parsed.path === "string" ? parsed.path : "",
        content: typeof parsed.content === "string" ? parsed.content : "",
      }
    : parsed.args && typeof parsed.args === "object" && !Array.isArray(parsed.args)
      ? parsed.args
      : {};
  if (!tool) {
    await sendOpenAiToolResult(callId, {
      ok: false,
      text: "Tool error: missing tool name",
    });
    return;
  }

  setStatus("Tool", `Running ${tool} through OpenClaw...`);
  const result = await invokeBrowserTool({ tool, args });
  log("openai_tool_call", { tool, ok: result.ok });
  await sendClientTrace("openai_tool_call_completed", {
    callId,
    tool,
    ok: result.ok,
    text: result.text,
  });
  await sendOpenAiToolResult(callId, result);
}

async function logoutBrowser() {
  if (geminiSession) {
    await stopGeminiSession().catch(() => {});
  }
  whisperSessionActive = false;
  await jsonFetch(`${apiBase}/session/logout`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  log("browser_logged_out");
  setVoiceState(false);
  setTurnRecordingState(false);
  responseTextEl.textContent = "";
  responseShellEl.hidden = true;
  responseShellEl.classList.remove("is-visible");
  activeConversationId = null;
  activeAssistantEntryId = null;
  activeAssistantText = "";
  pendingNewConversation = false;
  persistedTranscriptEntries.clear();
  processedToolCalls.clear();
  toolManifest = null;
  await refreshStatus();
}

async function bootstrapOpenAi() {
  const instructions = await buildConversationContextPrompt();
  const payload = await jsonFetch(`${apiBase}/bootstrap/openai`, {
    method: "POST",
    body: JSON.stringify({
      instructions,
    }),
  });
  log("openai_bootstrap_ok");
  return payload;
}

async function startOpenAiWebRtc() {
  await startConversation("openai");
  const bootstrap = await bootstrapOpenAi();
  const clientSecret =
    bootstrap.session?.client_secret?.value ||
    bootstrap.client_secret?.value ||
    bootstrap.session?.value ||
    bootstrap.value;
  const model = bootstrap.session?.session?.model || bootstrap.session?.model || bootstrap.model;

  if (!clientSecret) {
    throw new Error("OpenAI bootstrap missing client secret");
  }
  if (!model) {
    throw new Error("OpenAI bootstrap missing model");
  }

  const media = await navigator.mediaDevices.getUserMedia({ audio: true });
  const pc = new RTCPeerConnection();
  pc.onconnectionstatechange = () => {
    void sendClientTrace("webrtc_connection_state", {
      state: pc.connectionState,
    });
  };
  pc.oniceconnectionstatechange = () => {
    void sendClientTrace("webrtc_ice_state", {
      state: pc.iceConnectionState,
    });
  };

  pc.ontrack = (event) => {
    const [stream] = event.streams;
    if (stream) {
      remoteAudioEl.srcObject = stream;
      remoteAudioEl.playsInline = true;
      remoteAudioEl.autoplay = true;
      const playPromise = remoteAudioEl.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch((error) => {
          log("remote_audio_play_error", { error: safeTraceError(error) });
          void sendClientTrace("remote_audio_play_error", {
            error: safeTraceError(error),
          }, "warn");
        });
      }
      void sendClientTrace("openai_remote_track_received", {
        trackCount: stream.getAudioTracks().length,
      });
    }
  };

  remoteAudioEl.onplaying = () => {
    void sendClientTrace("remote_audio_playing", {});
  };
  remoteAudioEl.onpause = () => {
    void sendClientTrace("remote_audio_paused", {});
  };
  remoteAudioEl.onended = () => {
    void sendClientTrace("remote_audio_ended", {});
  };
  remoteAudioEl.onerror = () => {
    void sendClientTrace("remote_audio_error", {
      code: remoteAudioEl.error?.code || null,
      message: remoteAudioEl.error?.message || null,
    }, "warn");
  };

  media.getTracks().forEach((track) => pc.addTrack(track, media));
  const dataChannel = pc.createDataChannel("oai-events");
  dataChannel.onopen = () => {
    void sendClientTrace("openai_data_channel_open", {});
  };
  dataChannel.onclose = () => {
    void sendClientTrace("openai_data_channel_close", {});
  };
  dataChannel.onerror = () => {
    void sendClientTrace("openai_data_channel_error", {});
  };
  dataChannel.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === "session.created" || data.type === "session.updated") {
        void sendClientTrace("openai_session_event", {
          type: data.type,
          outputModalities: data.session?.output_modalities || null,
          voice: data.session?.audio?.output?.voice || null,
          turnDetection: data.session?.audio?.input?.turn_detection?.type || null,
        });
      } else if (data.type === "input_audio_buffer.speech_started" || data.type === "input_audio_buffer.speech_stopped") {
        void sendClientTrace("openai_speech_activity", {
          type: data.type,
        });
      } else if (data.type === "conversation.item.input_audio_transcription.completed" && data.transcript) {
        const entryId = data.item_id || `user-${Date.now()}`;
        void sendClientTrace("openai_user_transcription_completed", {
          itemId: entryId,
          transcript: data.transcript,
        });
        void persistTranscript("user", data.transcript, entryId).catch((error) => {
          log("transcript_persist_error", { error: error.message });
        });
      } else if (data.type === "response.created") {
        void sendClientTrace("openai_response_created", {
          responseId: data.response?.id || null,
        });
        beginAssistantResponse(data.response?.id || `assistant-${Date.now()}`);
      } else if (data.type === "response.audio_transcript.delta" && data.delta) {
        appendAssistantChunk(data.response_id || activeAssistantEntryId || `assistant-${Date.now()}`, data.delta);
      } else if (data.type === "response.output_text.delta" && data.delta) {
        appendAssistantChunk(data.response_id || activeAssistantEntryId || `assistant-${Date.now()}`, data.delta);
      } else if (data.type === "response.audio_transcript.done" && data.transcript) {
        const entryId = data.response_id || activeAssistantEntryId || `assistant-${Date.now()}`;
        commitAssistantText(entryId, data.transcript);
        void persistTranscript("assistant", data.transcript, entryId).catch((error) => {
          log("transcript_persist_error", { error: error.message });
        });
      } else if (data.type === "response.output_text.done" && data.text) {
        const entryId = data.response_id || activeAssistantEntryId || `assistant-${Date.now()}`;
        commitAssistantText(entryId, data.text);
        void persistTranscript("assistant", data.text, entryId).catch((error) => {
          log("transcript_persist_error", { error: error.message });
        });
      } else if (data.type === "response.done" && Array.isArray(data.response?.output)) {
        const responseText = data.response.output
          .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
          .map((part) => {
            if (typeof part?.transcript === "string" && part.transcript.trim()) return part.transcript.trim();
            if (typeof part?.text === "string" && part.text.trim()) return part.text.trim();
            return "";
          })
          .filter(Boolean)
          .join("\n");
        if (responseText) {
          const entryId = data.response?.id || activeAssistantEntryId || `assistant-${Date.now()}`;
          commitAssistantText(entryId, responseText);
          void persistTranscript("assistant", responseText, entryId).catch((error) => {
            log("transcript_persist_error", { error: error.message });
          });
        }
      } else if (data.type === "response.output_item.done" && data.item?.type === "function_call") {
        void handleOpenAiToolCall(
          data.item.call_id,
          data.item.name,
          data.item.arguments,
        ).catch((error) => {
          log("openai_tool_error", { error: error.message });
        });
      } else if (data.type === "response.function_call_arguments.done") {
        void handleOpenAiToolCall(
          data.call_id,
          data.name,
          data.arguments,
        ).catch((error) => {
          log("openai_tool_error", { error: error.message });
        });
      }
      if (data.type === "error") {
        log("openai_event_error", data);
        void sendClientTrace("openai_event_error", data, "warn");
      }
    } catch {
      log("openai_event_raw");
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const response = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    body: offer.sdp,
    headers: {
      Authorization: `Bearer ${clientSecret}`,
      "Content-Type": "application/sdp",
    },
  });

  if (!response.ok) {
    throw new Error(`OpenAI SDP exchange failed (${response.status})`);
  }

  const answer = await response.text();
  await pc.setRemoteDescription({
    type: "answer",
    sdp: answer,
  });

  openAiSession = { pc, media, dataChannel };
  setVoiceState(true);
  log("openai_webrtc_connected", { model });
}

function stopOpenAiSession() {
  if (!openAiSession) {
    return;
  }
  openAiSession.dataChannel?.close();
  openAiSession.pc?.close();
  openAiSession.media?.getTracks?.().forEach((track) => track.stop());
  openAiSession = null;
  void endConversation("openai").catch((error) => {
    log("session_end_error", { error: error.message });
  });
  setVoiceState(false);
  const copy = providerStateCopy(selectedProvider);
  setStatus(copy.title, "Voice session ended.");
  log("openai_webrtc_closed");
}

async function stopGeminiSession() {
  if (!geminiSession) {
    return;
  }
  const active = geminiSession;
  geminiSession = null;
  await active.stop().catch((error) => {
    log("gemini_stop_error", { error: error.message });
  });
  await endConversation("google").catch((error) => {
    log("session_end_error", { error: error.message });
  });
  setVoiceState(false);
  const copy = providerStateCopy(selectedProvider);
  setStatus(copy.title, "Gemini live session ended.");
  log("gemini_live_closed");
}

async function mintGeminiToken() {
  const payload = await jsonFetch(`${apiBase}/bootstrap/gemini`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  setStatus("Gemini Ready", "Bootstrap token minted successfully.");
  showTranscript(`Gemini bootstrap is ready for model ${payload.model}.`, false);
  log("gemini_bootstrap_ok");
}

async function sendOpenAiSttTtsTurn(audioBase64, mimeType) {
  await startConversation("openai");
  setStatus("Processing", "Transcribing and generating a spoken reply...");
  const payload = await jsonFetch(`${apiBase}/chat/turn`, {
    method: "POST",
    body: JSON.stringify({
      mode: "openai_stt_tts",
      conversationId: activeConversationId,
      audioBase64,
      mimeType,
      instructions: instructionsEl.value.trim(),
    }),
  });
  showTranscript(payload.assistantText || "", false);
  if (payload.speech?.audioBase64) {
    await playSpeechAudio(payload.speech.audioBase64, payload.speech.mimeType || "audio/mpeg").catch((error) => {
      log("stt_tts_play_error", { error: safeTraceError(error) });
    });
  }
  await refreshConversations();
  setStatus("Ready", "Turn complete.");
  log("openai_stt_tts_turn_complete", {
    conversationId: activeConversationId,
  });
}

async function toggleOpenAiSttTtsTurn() {
  if (!whisperSessionActive) {
    await startConversation("openai");
    whisperSessionActive = true;
    setTurnRecordingState(false);
    setStatus("Whisper Ready", "Tap to record your first turn. Use End to close this session.");
    syncWhisperUi();
    return;
  }

  if (isTurnRecording && sttTtsRecorder) {
    sttTtsRecorder.stop();
    setTurnRecordingState(false);
    setStatus("Processing", "Uploading audio turn...");
    return;
  }

  sttTtsStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  sttTtsChunks = [];
  sttTtsRecorder = new MediaRecorder(sttTtsStream, { mimeType: "audio/webm" });
  sttTtsRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      sttTtsChunks.push(event.data);
    }
  };
  sttTtsRecorder.onstop = async () => {
    const blob = new Blob(sttTtsChunks, { type: sttTtsRecorder.mimeType || "audio/webm" });
    const buffer = await blob.arrayBuffer();
    const binary = new Uint8Array(buffer);
    let binaryString = "";
    for (const byte of binary) {
      binaryString += String.fromCharCode(byte);
    }
    const audioBase64 = btoa(binaryString);
    sttTtsStream?.getTracks().forEach((track) => track.stop());
    sttTtsStream = null;
    sttTtsRecorder = null;
    sttTtsChunks = [];
    await sendOpenAiSttTtsTurn(audioBase64, blob.type || "audio/webm");
  };
  sttTtsRecorder.start();
  setTurnRecordingState(true);
  setStatus("Recording...", "Tap again to stop and send this turn.");
}

async function endWhisperSession() {
  if (sttTtsRecorder && isTurnRecording) {
    try {
      sttTtsRecorder.stop();
    } catch {
      // ignore stop races
    }
  }
  sttTtsStream?.getTracks().forEach((track) => track.stop());
  sttTtsStream = null;
  sttTtsRecorder = null;
  sttTtsChunks = [];
  whisperSessionActive = false;
  setTurnRecordingState(false);
  await endConversation("openai").catch((error) => {
    log("whisper_session_end_error", { error: error.message });
  });
  const copy = providerStateCopy(selectedProvider);
  setStatus(copy.title, "Whisper session ended.");
  syncWhisperUi();
}

async function handleVoiceButton() {
  await ensureSpeechPlaybackContext().catch((error) => {
    log("speech_context_unlock_error", { error: safeTraceError(error) });
  });
  if (!pluginStatus?.authenticated) {
    await authenticateBrowser();
    return;
  }

  const provider = selectedProvider;
  if (isVoiceLive) {
    if (provider === "google" && geminiSession) {
      await stopGeminiSession();
    } else {
      stopOpenAiSession();
    }
    return;
  }

  if (provider === "openai_stt_tts") {
    await toggleOpenAiSttTtsTurn();
    return;
  }

  if (provider === "google") {
    setStatus("Connecting", "Opening Gemini live voice session...");
    const { startGeminiLiveSession } = await loadGeminiModule();
    geminiSession = await startGeminiLiveSession(buildVoiceRuntimeContext());
    return;
  }

  setStatus("Connecting", "Opening secure realtime voice session...");
  await startOpenAiWebRtc();
}

voiceButtonEl.addEventListener("click", () => {
  void handleVoiceButton().catch((error) => {
    setVoiceState(false);
    setStatus("Error", error.message);
    log("voice_error", { error: error.message });
  });
});

authButtonEl.addEventListener("click", () => {
  if (pluginStatus?.authenticated) {
    setupPanelEl.hidden = false;
    return;
  }
  void authenticateBrowser().catch((error) => {
    setStatus("Error", error.message);
    log("auth_error", { error: error.message });
  });
});

function handleProviderSelection(value) {
  selectedProvider = value;
  syncProviderUi();
  if (!isVoiceLive && !isTurnRecording) {
    const copy = providerStateCopy(selectedProvider);
    setStatus(copy.title, copy.detail);
  }
}

providerInlineEl?.addEventListener("change", () => {
  handleProviderSelection(providerInlineEl.value);
});

whisperEndButtonEl?.addEventListener("click", () => {
  void endWhisperSession().catch((error) => {
    setStatus("Error", error.message);
    log("whisper_end_error", { error: error.message });
  });
});

whisperReplayButtonEl?.addEventListener("click", () => {
  if (!lastSpeechPayload?.base64) {
    setStatus("Whisper Ready", "No previous spoken reply is available yet.");
    log("speech_replay_missing");
    return;
  }
  void ensureSpeechPlaybackContext()
    .then(() => playSpeechAudio(lastSpeechPayload.base64, lastSpeechPayload.mimeType || "audio/mpeg"))
    .then(() => {
      setStatus("Whisper Ready", "Replaying the last spoken reply.");
      log("speech_replay_triggered", {
        mimeType: lastSpeechPayload.mimeType || "audio/mpeg",
      });
    })
    .catch((error) => {
      setStatus("Error", error.message);
      log("speech_replay_error", { error: safeTraceError(error) });
    });
});

continueButtonEl.addEventListener("click", () => {
  pendingNewConversation = false;
  if (conversationState.currentConversationId) {
    activeConversationId = conversationState.currentConversationId;
    setStatus("Ready", "Loaded the latest conversation from this device.");
    renderHistory(conversationState);
    void loadSelectedConversationPreview().catch((error) => {
      log("conversation_preview_error", { error: error.message });
    });
    return;
  }
  setStatus("Ready", "No recent conversation on this device yet.");
});

newChatButtonEl.addEventListener("click", () => {
  pendingNewConversation = true;
  activeConversationId = null;
  whisperSessionActive = false;
  responseShellEl.hidden = true;
  responseShellEl.classList.remove("is-visible");
  responseTextEl.textContent = "";
  setStatus("Ready", "A new conversation will start the next time you talk.");
  historySummaryEl.textContent = "New conversation queued for this device.";
  if (!historyShellEl.hidden) {
    renderHistory(conversationState);
  }
});

historyButtonEl.addEventListener("click", () => {
  historyShellEl.hidden = !historyShellEl.hidden;
  syncPanelStateButtons();
  if (!historyShellEl.hidden) {
    void refreshConversations().catch((error) => {
      log("history_error", { error: error.message });
    });
  }
});

setupToggleEl.addEventListener("click", () => {
  setupPanelEl.hidden = !setupPanelEl.hidden;
  syncPanelStateButtons();
});

trustButtonEl.addEventListener("click", () => {
  setupPanelEl.hidden = false;
  log("https_trust_help", {
    note: "Trusted HTTPS means your phone accepts this site's certificate as secure. Without that, iPhone browsers may block or degrade microphone and audio behavior.",
  });
  setStatus("Trusted HTTPS", "Your phone needs to trust this site's certificate for the most reliable mic and audio behavior.");
});

document.getElementById("refresh-status").addEventListener("click", () => {
  void refreshStatus();
});


document.getElementById("gemini-token").addEventListener("click", () => {
  void mintGeminiToken().catch((error) => {
    setStatus("Error", error.message);
    log("gemini_error", { error: error.message });
  });
});

document.getElementById("logout").addEventListener("click", () => {
  void logoutBrowser().catch((error) => {
    setStatus("Error", error.message);
    log("logout_error", { error: error.message });
  });
});

document.getElementById("clear-log").addEventListener("click", () => {
  window.sessionStorage.removeItem(sessionLogStorageKey);
});

historySearchButtonEl.addEventListener("click", () => {
  void searchConversations().catch((error) => {
    log("history_search_error", { error: error.message });
  });
});

historySearchEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void searchConversations().catch((error) => {
      log("history_search_error", { error: error.message });
    });
  }
});

historySummarizeButtonEl?.addEventListener("click", () => {
  void summarizeSelectedConversation().catch((error) => {
    log("history_summarize_error", { error: error.message });
    setStatus("Error", error.message);
  });
});

window.addEventListener("beforeunload", () => {
  stopOpenAiSession();
  whisperSessionActive = false;
  void stopGeminiSession();
  sttTtsStream?.getTracks().forEach((track) => track.stop());
});

wireDebugDrawer();
disablePullToRefresh();
syncProviderUi();
void refreshStatus();

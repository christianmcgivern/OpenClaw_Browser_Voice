const rootUrl = new URL(".", window.location.href);
const routeBase = rootUrl.pathname.replace(/\/$/, "");
const apiBase = `${routeBase}/api`;

const chatContinueEl = document.getElementById("chat-continue");
const chatNewEl = document.getElementById("chat-new");
const chatHistoryEl = document.getElementById("chat-history");
const chatThreadEl = document.getElementById("chat-thread");
const chatInputEl = document.getElementById("chat-input");
const chatSendEl = document.getElementById("chat-send");
const chatStatusEl = document.getElementById("chat-status");
const chatHistoryShellEl = document.getElementById("chat-history-shell");
const chatHistorySummaryEl = document.getElementById("chat-history-summary");
const chatHistorySearchEl = document.getElementById("chat-history-search");
const chatHistorySearchButtonEl = document.getElementById("chat-history-search-button");
const chatHistoryCurrentDeviceEl = document.getElementById("chat-history-current-device");
const chatHistoryOtherDevicesEl = document.getElementById("chat-history-other-devices");
const chatHistorySharedEl = document.getElementById("chat-history-shared");
const themeStorageKey = "browser_voice_theme";

let pluginStatus = null;
let activeConversationId = null;
let conversationState = {
  currentConversationId: null,
  currentDevice: [],
  otherDevices: [],
  shared: [],
};

function applyTheme() {
  const theme = window.localStorage.getItem(themeStorageKey) || "coast";
  document.body.dataset.theme = theme === "studio" ? "studio" : "coast";
}

function syncPanelStateButtons() {
  chatHistoryEl?.classList.toggle("is-active", !chatHistoryShellEl?.hidden);
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

function setStatus(text) {
  chatStatusEl.textContent = text;
}

function appendBubble(role, text) {
  const item = document.createElement("div");
  item.className = `chat-message ${role === "assistant" ? "is-assistant" : "is-user"}`;
  item.textContent = text;
  chatThreadEl.appendChild(item);
  chatThreadEl.scrollTop = chatThreadEl.scrollHeight;
}

function replaceThread(messages) {
  chatThreadEl.textContent = "";
  for (const message of messages) {
    appendBubble(message.role, message.text);
  }
}

function formatTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
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
      chatHistorySummaryEl.textContent = `Selected: ${item.title || "Conversation"}`;
      void loadThread();
      renderHistory(conversationState);
      setStatus(`Selected ${item.title || "conversation"}.`);
    });
    target.appendChild(button);
  }
}

function renderHistory(payload) {
  conversationState = payload;
  chatHistorySummaryEl.textContent = payload.currentConversationId
    ? "Current conversation ready to continue."
    : "No recent conversation on this device.";
  renderConversationList(chatHistoryCurrentDeviceEl, payload.currentDevice || [], "No device-local conversations yet.");
  renderConversationList(chatHistoryOtherDevicesEl, payload.otherDevices || [], "No conversations from other devices yet.");
  renderConversationList(chatHistorySharedEl, payload.shared || [], "No shared conversations yet.");
}

async function refreshStatus() {
  pluginStatus = await jsonFetch(`${apiBase}/status`, {
    method: "GET",
    headers: {},
  });
  if (!pluginStatus.authenticated) {
    setStatus("Authenticate on the main voice page before using chat.");
    return;
  }
  setStatus("Ready.");
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

async function searchConversations() {
  const query = chatHistorySearchEl.value.trim();
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

async function startConversation(forceNew = false) {
  const payload = await jsonFetch(`${apiBase}/session/start`, {
    method: "POST",
    body: JSON.stringify({
      provider: "openai",
      ...(activeConversationId ? { conversationId: activeConversationId } : {}),
      ...(forceNew ? { forceNew: true } : {}),
    }),
  });
  activeConversationId = payload.conversationId;
  await refreshConversations();
  await loadThread();
}

async function loadThread() {
  if (!activeConversationId) {
    replaceThread([]);
    return;
  }
  const payload = await jsonFetch(`${apiBase}/conversations/thread?conversationId=${encodeURIComponent(activeConversationId)}`, {
    method: "GET",
    headers: {},
  });
  replaceThread(payload.messages || []);
}

async function sendTextTurn(text) {
  if (!activeConversationId) {
    await startConversation(false);
  }
  appendBubble("user", text);
  setStatus("Thinking...");
  const payload = await jsonFetch(`${apiBase}/chat/turn`, {
    method: "POST",
    body: JSON.stringify({
      mode: "openai_text",
      conversationId: activeConversationId,
      text,
    }),
  });
  appendBubble("assistant", payload.assistantText || "");
  await refreshConversations();
  setStatus("Ready.");
}

chatSendEl.addEventListener("click", () => {
  const text = chatInputEl.value.trim();
  if (!text) {
    setStatus("Enter a message first.");
    return;
  }
  chatInputEl.value = "";
  void sendTextTurn(text).catch((error) => {
    setStatus(error.message);
  });
});

chatInputEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatSendEl.click();
  }
});

chatContinueEl.addEventListener("click", () => {
  if (conversationState.currentConversationId) {
    activeConversationId = conversationState.currentConversationId;
    void loadThread();
    setStatus("Continuing the latest conversation on this device.");
  } else {
    setStatus("No recent conversation on this device yet.");
  }
});

chatNewEl.addEventListener("click", () => {
  void startConversation(true).then(() => {
    replaceThread([]);
    setStatus("New conversation started.");
  }).catch((error) => {
    setStatus(error.message);
  });
});

chatHistoryEl.addEventListener("click", () => {
  chatHistoryShellEl.hidden = !chatHistoryShellEl.hidden;
  syncPanelStateButtons();
  if (!chatHistoryShellEl.hidden) {
    void refreshConversations().catch((error) => setStatus(error.message));
  }
});

chatHistorySearchButtonEl.addEventListener("click", () => {
  void searchConversations().catch((error) => setStatus(error.message));
});

chatHistorySearchEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void searchConversations().catch((error) => setStatus(error.message));
  }
});

async function init() {
  applyTheme();
  syncPanelStateButtons();
  await refreshStatus();
  await refreshConversations();
  if (activeConversationId) {
    await loadThread();
  }
}

void init().catch((error) => {
  setStatus(error.message);
});

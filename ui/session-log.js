const logEl = document.getElementById("log");
const clearButtonEl = document.getElementById("session-log-clear");
const apiBase = `${new URL(".", window.location.href).pathname.replace(/\/$/, "")}/api`;

function formatEntry(entry) {
  const parts = [];
  if (entry.ts) parts.push(String(entry.ts));
  if (entry.event) parts.push(String(entry.event));
  if (entry.message) parts.push(String(entry.message));
  if (entry.provider) parts.push(`provider=${entry.provider}`);
  if (entry.mode) parts.push(`mode=${entry.mode}`);
  if (entry.conversationId) parts.push(`conversation=${entry.conversationId}`);
  if (entry.dataPreview) parts.push(`data=${entry.dataPreview}`);
  if (entry.responsePreview) parts.push(`response=${entry.responsePreview}`);
  if (entry.preview) parts.push(`preview=${entry.preview}`);
  return parts.join("\n");
}

async function render() {
  try {
    const response = await fetch(`${apiBase}/logs?scope=session&lines=250`, {
      credentials: "same-origin",
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error || `HTTP ${response.status}`);
    }
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    logEl.textContent = entries.length
      ? entries.map(formatEntry).join("\n\n")
      : "No session log entries yet.";
  } catch (error) {
    logEl.textContent = `Could not load session log: ${error instanceof Error ? error.message : String(error)}`;
  }
}

clearButtonEl.addEventListener("click", () => {
  void render();
});

void render();

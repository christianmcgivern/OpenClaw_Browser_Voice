const rootUrl = new URL(".", window.location.href);
const routeBase = rootUrl.pathname.replace(/\/trace(?:\.html)?$/, "").replace(/\/$/, "");
const apiBase = `${routeBase}/api`;
const cardsEl = document.getElementById("trace-cards");
const refreshButtonEl = document.getElementById("trace-refresh");

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
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

function deriveStatus(group) {
  const texts = group.entries.map((entry) => `${entry.message || ""} ${entry.reason || ""} ${entry.textPreview || ""}`.toLowerCase()).join(" ");
  if (group.entries.some((entry) => entry.event === "tool_trace_route_result" && entry.ok === true)) {
    return "success";
  }
  if (texts.includes("error") || texts.includes("failed") || group.entries.some((entry) => entry.ok === false)) {
    return "error";
  }
  if (group.entries.some((entry) => String(entry.event).includes("fallback"))) {
    return "warn";
  }
  return "neutral";
}

function summarizeStep(entry) {
  const labels = {
    client_trace: "Browser",
    tool_trace_route_begin: "Plugin Route",
    tool_invoke_begin: "Tool Bridge",
    tool_invoke_http_ok: "Gateway",
    tool_invoke_http_error: "Gateway",
    tool_invoke_http_parse_error: "Gateway",
    tool_invoke_http_request_error: "Gateway",
    tool_invoke_local_fallback_begin: "Local Fallback",
    tool_invoke_local_fallback_done: "Local Fallback",
    tool_trace_route_result: "Final Result",
  };
  const title = labels[entry.event] || entry.event;
  const detail = entry.message || entry.reason || entry.textPreview || (entry.ok === true ? "ok" : "");
  let tone = "neutral";
  if (entry.ok === true || entry.event === "tool_invoke_http_ok") tone = "success";
  if (entry.ok === false || String(detail).toLowerCase().includes("error")) tone = "error";
  if (String(entry.event).includes("fallback")) tone = "warn";
  return { title, detail, tone, time: formatTime(entry.ts) };
}

function groupEntries(entries) {
  const groups = [];
  let current = null;
  for (const entry of entries) {
    if (entry.event === "tool_trace_route_begin" || !current) {
      current = {
        tool: entry.tool || "unknown",
        conversationId: entry.conversationId || "unknown",
        entries: [],
      };
      groups.push(current);
    }
    current.entries.push(entry);
    if (entry.event === "tool_trace_route_result") {
      current = null;
    }
  }
  return groups.slice(-8).reverse();
}

function renderGroups(groups) {
  if (!groups.length) {
    cardsEl.innerHTML = `<article class="trace-card"><div class="trace-card-title">No tool trace yet.</div></article>`;
    return;
  }

  cardsEl.innerHTML = groups.map((group) => {
    const status = deriveStatus(group);
    const steps = group.entries.map(summarizeStep);
    return `
      <article class="trace-card trace-card-${status}">
        <div class="trace-card-head">
          <div>
            <div class="trace-card-title">${escapeHtml(group.tool)}</div>
            <div class="trace-card-meta">${escapeHtml(group.conversationId)}</div>
          </div>
          <div class="trace-status trace-status-${status}">${status}</div>
        </div>
        <div class="trace-flow">
          ${steps.map((step) => `
            <div class="trace-step trace-step-${step.tone}">
              <div class="trace-step-title">${escapeHtml(step.title)}</div>
              <div class="trace-step-time">${escapeHtml(step.time)}</div>
              <div class="trace-step-detail">${escapeHtml(step.detail || "no detail")}</div>
            </div>
          `).join("")}
        </div>
      </article>
    `;
  }).join("");
}

async function refreshTrace() {
  const payload = await jsonFetch(`${apiBase}/logs?scope=tools&lines=160`, { method: "GET" });
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  renderGroups(groupEntries(entries));
}

refreshButtonEl.addEventListener("click", () => {
  void refreshTrace();
});

void refreshTrace();

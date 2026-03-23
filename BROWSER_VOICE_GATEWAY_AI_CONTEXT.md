# Browser Voice Gateway AI Context

This document is for handing to another AI model so it can understand this plugin quickly without guessing.

Everything below is based on the current code in this plugin.

## Purpose

`browser-voice-gateway` gives OpenClaw a dedicated HTTPS browser client for:

- live browser voice with OpenAI Realtime
- turn-based voice with OpenAI Whisper STT/TTS
- live Gemini voice through a plugin-side bridge
- remote text chat
- history, continuity, and voice-session summaries
- browser-side OpenClaw tool use

## Main Files

Core plugin entry:

- [index.ts](index.ts)

Providers:

- [providers/openai-provider.ts](providers/openai-provider.ts)
- [providers/gemini-provider.ts](providers/gemini-provider.ts)
- [providers/gemini-live-bridge.ts](providers/gemini-live-bridge.ts)

Routes:

- [routes/static-routes.ts](routes/static-routes.ts)
- [routes/provider-routes.ts](routes/provider-routes.ts)
- [routes/session-routes.ts](routes/session-routes.ts)
- [routes/conversation-routes.ts](routes/conversation-routes.ts)
- [routes/chat-routes.ts](routes/chat-routes.ts)
- [routes/diagnostic-routes.ts](routes/diagnostic-routes.ts)

Conversation storage:

- [store/conversation-store.ts](store/conversation-store.ts)

Browser UI:

- [ui/index.html](ui/index.html)
- [ui/app.js](ui/app.js)
- [ui/chat.html](ui/chat.html)
- [ui/chat.js](ui/chat.js)
- [ui/gemini-live.js](ui/gemini-live.js)
- [ui/style.css](ui/style.css)

## Provider Modes

Voice page modes:

- `openai`
  - shown in UI as `OpenAI Realtime`
  - browser-native WebRTC session to OpenAI
- `openai_stt_tts`
  - shown in UI as `OpenAI Whisper`
  - turn-based audio in, text reasoning, audio out
- `google`
  - shown in UI as `Gemini Live`
  - browser talks to plugin bridge
  - plugin talks to Gemini Live

Chat page:

- always text-only
- always uses `mode: "openai_text"` in the browser
- server requires the current OpenClaw default model to be an OpenAI model

## Authentication And Browser Trust

Browser trust is separate from provider auth.

Browser trust:

- login endpoint:
  - `POST /browser-voice/api/session/login`
- request field:
  - `accessCode`
- access code source:
  - `plugins.entries.browser-voice-gateway.config.browserAccessCode`
- login input is trimmed to 256 characters by `validateBodyString(...)`
- comparison uses a SHA-256 digest with `timingSafeEqual(...)`
- successful login creates:
  - an `HttpOnly` cookie named `openclaw_browser_voice`
  - a trusted browser record

Trusted browser storage:

- `~/.openclaw/browser-voice/trusted-browsers.json`

Browser session lifetime:

- controlled by `browserSessionTtlHours`

## Provider Keys And Ephemeral Credentials

Long-term provider keys stay in OpenClaw.

Required providers:

- `openai`
- `google`

Key resolution:

- `resolveProviderApiKey(...)` in [index.ts](index.ts)
- uses OpenClaw runtime model auth

OpenAI Realtime bootstrap:

- endpoint:
  - `POST /browser-voice/api/bootstrap/openai`
- implementation:
  - `createOpenAiClientSecret(...)` in [providers/openai-provider.ts](providers/openai-provider.ts)
- provider call:
  - `POST https://api.openai.com/v1/realtime/client_secrets`
- browser receives:
  - short-lived Realtime client secret payload

Gemini bootstrap:

- endpoint:
  - `POST /browser-voice/api/bootstrap/gemini`
- implementation:
  - `createGeminiEphemeralToken(...)` in [providers/gemini-provider.ts](providers/gemini-provider.ts)
- provider-side SDK usage:
  - `@google/genai`
- browser/plugin receives:
  - short-lived Gemini token name

Gemini runtime note:

- the Google SDK is used server-side for token minting
- the live runtime path is not the browser SDK
- Gemini live runtime uses the plugin-side bridge in [providers/gemini-live-bridge.ts](providers/gemini-live-bridge.ts)

## Static Pages

Served by [routes/static-routes.ts](routes/static-routes.ts):

- `GET /browser-voice/`
- `GET /browser-voice/index.html`
- `GET /browser-voice/app.js`
- `GET /browser-voice/chat`
- `GET /browser-voice/chat.html`
- `GET /browser-voice/chat.js`
- `GET /browser-voice/gemini-live.js`
- `GET /browser-voice/trace`
- `GET /browser-voice/trace.html`
- `GET /browser-voice/trace.js`
- `GET /browser-voice/session-log`
- `GET /browser-voice/session-log.html`
- `GET /browser-voice/session-log.js`
- `GET /browser-voice/style.css`

## API Endpoints

Provider bootstrap:

- `POST /browser-voice/api/bootstrap/openai`
- `POST /browser-voice/api/bootstrap/gemini`

Session/auth:

- `POST /browser-voice/api/session/login`
- `POST /browser-voice/api/session/logout`
- `POST /browser-voice/api/session/start`
- `POST /browser-voice/api/session/end`
- `POST /browser-voice/api/session/transcript`

Conversation/history:

- `GET /browser-voice/api/conversations`
- `GET /browser-voice/api/conversations/current`
- `POST /browser-voice/api/conversations/search`
- `GET /browser-voice/api/conversations/thread`
- `POST /browser-voice/api/conversations/summarize`

Chat:

- `POST /browser-voice/api/chat/turn`

Diagnostics/tools:

- `GET /browser-voice/api/status`
- `POST /browser-voice/api/client-log`
- `GET /browser-voice/api/logs`
- `GET /browser-voice/api/tools/manifest`
- `POST /browser-voice/api/tools/invoke`

Gemini bridge socket:

- `WS /browser-voice/ws/gemini-live`

## Conversation Model

Conversation metadata lives in:

- `~/.openclaw/browser-voice/conversations.json`

Each conversation tracks:

- `id`
- `sessionKey`
- `title`
- `summary`
- `browserId`
- `browserLabel`
- `ownerBrowserIds`
- `mode`
- `provider`
- timestamps
- `preview`
- `sessionFile`

Per-conversation OpenClaw session key:

- `agent:main:browser-voice:<conversationId>`

Full transcript storage:

- `~/.openclaw/agents/main/sessions/`

Trusted browser state and conversation metadata are separate.

## History And Continuity

Default behavior:

- device-aware continuity
- `Latest` loads the most recent conversation for the current trusted browser
- `Browse History` loads accessible past conversations

History groups:

- `This Device`
- `Other Devices`
- `Shared`

Important distinction:

- UI history display uses the full visible thread
- provider context injection uses summary + recent raw turns

Selecting a conversation:

- loads the full non-synthetic thread into the `Live Response` area

Starting a voice session on a selected conversation:

- uses the stored summary if present
- plus recent raw turns
- not the full transcript

## Summaries

Scope:

- voice sessions only
- text chat does not currently use the summary flow

Automatic summary trigger:

- on `POST /api/session/end`

Manual summary trigger:

- `POST /browser-voice/api/conversations/summarize`
- also exposed in UI as `Summarize Selected`

Summary source:

- full non-synthetic conversation transcript

Summary output:

- `Title:`
- `Summary:`
- summary target is 8 sentences or fewer

Current summary implementation:

- `summarizeConversationForHistory(...)` in [index.ts](index.ts)
- `summarizeOpenAiConversation(...)` in [providers/openai-provider.ts](providers/openai-provider.ts)

Current limitation:

- summary generation requires the OpenClaw default model provider to be OpenAI

## OpenAI Realtime Flow

1. browser calls `POST /api/session/start`
2. browser calls `POST /api/bootstrap/openai`
3. plugin mints short-lived OpenAI client secret
4. browser opens WebRTC directly to OpenAI
5. browser streams mic audio
6. browser receives audio back
7. browser mirrors transcript events through `POST /api/session/transcript`
8. plugin persists transcript into OpenClaw session history
9. session end triggers summary generation

OpenAI live provider config is built in [providers/openai-provider.ts](providers/openai-provider.ts):

- model from plugin config
- output audio only
- input transcription model `whisper-1`
- server VAD
- OpenClaw tool definitions

## OpenAI Whisper Flow

This is not Realtime. It is turn-based audio in / audio out.

Pipeline:

- STT:
  - `whisper-1`
- reasoning:
  - OpenClaw default model
- TTS:
  - `tts-1`

Browser interaction:

- first tap is `Start`
- session stays active on the page
- main button becomes record/send turn control
- `End` appears only for Whisper mode after session start
- `Play Last Reply` replays the last returned TTS response

Server route:

- `POST /browser-voice/api/chat/turn`
- `mode: "openai_stt_tts"`

## Gemini Live Flow

Gemini is intentionally bridged through the plugin.

Reason:

- direct browser Gemini socket behavior was unreliable on iPhone/WebKit

Runtime flow:

1. browser calls `POST /api/session/start`
2. browser opens `WS /browser-voice/ws/gemini-live`
3. plugin mints short-lived Gemini token
4. plugin opens Gemini provider socket
5. plugin relays browser audio chunks to Gemini
6. plugin relays output text/audio back to browser
7. plugin persists transcripts
8. plugin injects prior context:
   - as setup/system instruction
   - and as an explicit initial text turn after `setupComplete`

Browser implementation:

- [ui/gemini-live.js](ui/gemini-live.js)

Bridge implementation:

- [providers/gemini-live-bridge.ts](providers/gemini-live-bridge.ts)

## Text Chat Flow

Chat page:

- `/browser-voice/chat`

UI is text-only:

- `Latest`
- `New`
- `Browse History`
- message composer
- `Send`

Server route:

- `POST /browser-voice/api/chat/turn`
- `mode: "openai_text"`

Current limitation:

- chat currently requires the OpenClaw default model to be an OpenAI model

## Tool Use

Browser tool manifest endpoint:

- `GET /browser-voice/api/tools/manifest`

Tool invocation endpoint:

- `POST /browser-voice/api/tools/invoke`

Exposed function names:

- `openclaw_tool`
- `write_file`

Tool policy source:

- global OpenClaw `tools` config

Current default deny list shown in the docs/examples:

- `sessions_spawn`
- `sessions_send`
- `agents_list`

Tool fallback behavior:

- tries local gateway `/tools/invoke`
- if OpenClaw says `Tool not available: ...`, local fallback handles supported tools like `exec`, `read`, `write`, and `edit`

## Voice Page Buttons And Controls

Main voice page buttons:

- `⚙`
  - opens settings drawer
- voice button
  - starts/ends `OpenAI Realtime`
  - or starts Whisper session / toggles Whisper recording turn
  - or starts/ends Gemini live session
- `End`
  - Whisper only
- `Play Last Reply`
  - Whisper only
- `Voice Mode` select
  - `OpenAI Realtime`
  - `OpenAI Whisper`
  - `Gemini Live`
- `Chat`
  - opens chat page
- `Latest`
  - loads most recent conversation for this device
- `New`
  - queues a new conversation
- `Browse History`
  - opens history panel
- `Summarize Selected`
  - summarizes selected voice conversation

Settings drawer controls:

- `Authenticate`
- `What Is Trusted HTTPS?`
- `Access Code`
- `Instructions`
- `Refresh Status`
- `Test Gemini Token`
- `Open Tool Trace`
- `Open Session Log`
- `Clear Log`
- `Theme`
- `Log Display`
- `Logout`

Debug drawer:

- floating `Logs` button
- `Refresh`
- `Clear`
- `Close`

## Chat Page Buttons And Controls

- back button to voice page
- `Latest`
- `New`
- `Browse History`
- history search input
- `Search`
- message input
- `Send`

## Diagnostics

Separate pages:

- `/browser-voice/trace`
- `/browser-voice/session-log`

In-page logging:

- `Logs` drawer on voice page
- client traces are also sent to `POST /api/client-log`

Sanitized backend log access:

- `GET /browser-voice/api/logs?scope=session`
- `GET /browser-voice/api/logs?scope=tools`

## Security And Operational Notes

- browser access code should be changed from the generic example value
- access code should be treated like a private trust secret
- self-signed HTTPS is not the same as trusted HTTPS
- Safari on iPhone is not the recommended first test browser
- Chrome on iPhone still uses WebKit
- iPhone silent mode can affect audible playback for `OpenAI Whisper`
- cloud-hosted OpenClaw deployments were not fully validated during this build

## Runtime Path Assumptions

The plugin expects a standard OpenClaw home layout under `~/.openclaw/`.

The important runtime paths are:

- trusted browsers:
  - `~/.openclaw/browser-voice/trusted-browsers.json`
- conversation metadata:
  - `~/.openclaw/browser-voice/conversations.json`
- transcript sessions:
  - `~/.openclaw/agents/main/sessions/`

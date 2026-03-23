# Browser Voice Gateway Web Integration

This document is for developers who already have their own OpenClaw web interface and want to use this plugin as a backend/service layer.

The goal is:

- keep this plugin for auth, provider bootstrap, history, summaries, and tools
- replace the built-in UI with your own layout, buttons, and pages

You do **not** need to adopt the built-in browser UI.

You can:

- keep this plugin installed
- ignore the shipped `ui/` pages
- create your own buttons, panels, and pages
- wire your own frontend directly to this plugin's routes and Gemini bridge

In other words, you can treat this plugin as the service/backend layer and build your own interface on top of it.

## What You Can Reuse

This plugin already provides:

- browser trust/auth
- HTTPS hosting
- provider bootstrap
- Gemini live bridge
- conversation history
- summary generation for voice sessions
- transcript persistence
- tool manifest and tool invocation
- diagnostics endpoints

If you already have your own mission-control UI, you can keep:

- your own layout
- your own buttons
- your own styling
- your own page structure

and call this plugin's API directly.

## Recommended Integration Model

Treat this plugin as a backend + state service.

Use your own frontend to call:

- session/auth endpoints
- conversation endpoints
- provider bootstrap endpoints
- chat/voice endpoints
- tool endpoints
- diagnostics endpoints if desired

For Gemini live voice:

- use this plugin's same-origin bridge socket
- do not try to recreate the earlier raw browser Gemini socket path unless you are prepared to revalidate mobile browser behavior yourself

## Core Pages You Might Rebuild

You do not have to use the built-in UI pages:

- `/browser-voice/`
- `/browser-voice/chat`

Instead, your own web interface can create:

- a voice page
- a text chat page
- a history page or side panel
- a diagnostics page

## Core Backend Routes To Reuse

### Auth And Session

- `POST /browser-voice/api/session/login`
- `POST /browser-voice/api/session/logout`
- `POST /browser-voice/api/session/start`
- `POST /browser-voice/api/session/end`
- `POST /browser-voice/api/session/transcript`

### Provider Bootstrap

- `POST /browser-voice/api/bootstrap/openai`
- `POST /browser-voice/api/bootstrap/gemini`

### Conversations

- `GET /browser-voice/api/conversations`
- `GET /browser-voice/api/conversations/current`
- `POST /browser-voice/api/conversations/search`
- `GET /browser-voice/api/conversations/thread`
- `POST /browser-voice/api/conversations/summarize`

### Chat

- `POST /browser-voice/api/chat/turn`

### Tools

- `GET /browser-voice/api/tools/manifest`
- `POST /browser-voice/api/tools/invoke`

### Diagnostics

- `GET /browser-voice/api/status`
- `POST /browser-voice/api/client-log`
- `GET /browser-voice/api/logs`

### Gemini Live Bridge

- `WS /browser-voice/ws/gemini-live`

## Browser Trust Flow You Must Keep

If you build your own frontend, you still need to preserve the trust flow.

Required first step:

- `POST /browser-voice/api/session/login`

Payload:

```json
{
  "accessCode": "your-browser-access-code",
  "label": "optional browser label"
}
```

What happens:

- plugin validates the access code
- plugin sets the `openclaw_browser_voice` cookie
- future requests use that cookie

Without this step, protected routes will fail.

## OpenAI Realtime Integration

If you want your own OpenAI live-voice page, the backend contract is:

1. call `POST /browser-voice/api/session/start`
2. call `POST /browser-voice/api/bootstrap/openai`
3. use the returned short-lived client secret to open OpenAI WebRTC
4. mirror transcript events back through:
   - `POST /browser-voice/api/session/transcript`
5. close with:
   - `POST /browser-voice/api/session/end`

Important:

- OpenAI Realtime is browser-native in this plugin
- the browser does not receive the long-term OpenAI API key
- the browser receives a short-lived client secret only

## OpenAI Whisper Integration

If you want to rebuild Whisper mode in your own UI, the backend contract is:

- call `POST /browser-voice/api/session/start`
- record audio in the browser
- send the turn to `POST /browser-voice/api/chat/turn`

Payload shape:

```json
{
  "mode": "openai_stt_tts",
  "conversationId": "<conversation-id>",
  "audioBase64": "<base64-audio>",
  "mimeType": "audio/webm",
  "instructions": "optional instructions"
}
```

Response shape includes:

- `userText`
- `assistantText`
- `speech.audioBase64`
- `speech.mimeType`

Whisper mode in this plugin is:

- STT with `whisper-1`
- reasoning with the OpenClaw default model
- TTS with `tts-1`

## Gemini Live Integration

For your own frontend, Gemini should still use the plugin-side bridge.

Recommended flow:

1. call `POST /browser-voice/api/session/start`
2. open `WS /browser-voice/ws/gemini-live`
3. send:

```json
{
  "type": "start",
  "conversationId": "<conversation-id>",
  "instructions": "<optional context prompt>"
}
```

Then stream:

- `audio_chunk`
- `audio_end`

And listen for:

- `provider_connecting`
- `ready`
- `input_transcription`
- `output_text`
- `output_audio`
- `interrupted`
- `turn_complete`
- `error`

Important reason to keep this bridge:

- this plugin moved Gemini live away from the raw browser provider socket because of mobile browser reliability problems on iPhone/WebKit

## History And Continuity

You can reuse the plugin history model directly.

History list:

- `GET /browser-voice/api/conversations`

Thread loading:

- `GET /browser-voice/api/conversations/thread?conversationId=...`

Search:

- `POST /browser-voice/api/conversations/search`

Summary refresh:

- `POST /browser-voice/api/conversations/summarize`

Recommended frontend behavior:

- show full thread to the user
- let the plugin keep using summary + recent turns for provider context

That mirrors the built-in UI behavior.

## Tool Integration

Tool manifest:

- `GET /browser-voice/api/tools/manifest`

Tool invoke:

- `POST /browser-voice/api/tools/invoke`

Payload:

```json
{
  "conversationId": "<conversation-id>",
  "tool": "exec",
  "args": {
    "command": "pwd"
  }
}
```

The plugin already handles:

- OpenClaw policy reading
- deny-list enforcement
- gateway tool invocation
- local fallback for some tools if OpenClaw reports `Tool not available`

## Summaries

Voice session summaries are already implemented in the plugin.

Automatic trigger:

- `POST /browser-voice/api/session/end`

Manual trigger:

- `POST /browser-voice/api/conversations/summarize`

Stored summary fields:

- `title`
- `summary`

Current limitation:

- summary generation currently expects the OpenClaw default model to be OpenAI

## Storage You Do Not Need To Rebuild

The plugin already stores:

- trusted browsers:
  - `~/.openclaw/browser-voice/trusted-browsers.json`
- conversation metadata:
  - `~/.openclaw/browser-voice/conversations.json`
- OpenClaw session transcript history:
  - `~/.openclaw/agents/main/sessions/`

So if you build your own frontend, you can still use the existing plugin state layer.

## What To Extract From The Built-In UI

Useful browser behavior to copy from the shipped UI:

- provider selection logic in [ui/app.js](ui/app.js)
- Whisper session behavior in [ui/app.js](ui/app.js)
- Gemini bridge browser client in [ui/gemini-live.js](ui/gemini-live.js)
- chat page message flow in [ui/chat.js](ui/chat.js)

If your team wants only the backend/service behavior, these UI files are the first extraction reference.

## What Not To Assume

- do not assume Gemini browser SDK is the active runtime path
- do not assume text chat works with any non-OpenAI default model yet
- do not assume cloud-hosted OpenClaw is fully validated
- do not assume self-signed HTTPS is the same as a trusted mobile certificate
- do not assume iPhone silent mode will allow Whisper playback

## Practical Adoption Path

If you already have a mission-control UI, the safest adoption path is:

1. keep this plugin installed and configured
2. keep browser login and cookie handling
3. call the plugin APIs from your own pages
4. keep Gemini on the plugin bridge
5. keep summaries/history in the plugin
6. replace only the layout and interaction surface

That gives you the fastest integration with the least duplicated logic.

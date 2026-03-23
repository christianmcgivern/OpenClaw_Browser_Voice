# Browser Voice Gateway

`browser-voice-gateway` is a browser and mobile client plugin for OpenClaw.

It gives OpenClaw a dedicated HTTPS web UI for:

- live voice on phones and browsers
- turn-based voice using STT/TTS
- remote text chat
- conversation history and continuity
- OpenClaw tool use from the browser

It is designed so the user can open a web page on another device, authenticate that browser once, and use OpenClaw without exposing long-term provider API keys to the browser.

## What This Plugin Includes

Current implemented features:

- `OpenAI Realtime`
  - browser-native WebRTC live voice
- `OpenAI Whisper`
  - turn-based audio in, audio out
  - uses `whisper-1` for STT
  - uses the OpenClaw default text model for the reasoning step
  - uses `tts-1` for spoken playback
- `Gemini Live`
  - plugin-side live bridge for mobile reliability
  - browser connects to the plugin over your HTTPS origin
  - plugin connects to Gemini Live
- browser text chat page
  - uses the OpenClaw default text model
- browser tool bridge
  - browser sessions can use OpenClaw tools under the global OpenClaw tools policy
- conversation history
  - full transcript storage
  - device-aware continuity
  - history browsing
- conversation summarization for voice sessions
  - on voice session end
  - on demand for older voice conversations
- dedicated diagnostics
  - session log page
  - tool trace page
  - in-page logs drawer
- theme support
  - `Coast Glass`
  - `Studio Slate`

## What Stays Inside OpenClaw

This plugin keeps the important control plane inside OpenClaw.

OpenClaw owns:

- long-term provider API keys
- browser trust/auth
- conversation metadata
- transcript history
- summary generation
- tool policy
- tool execution

The browser does not store or paste real OpenAI or Gemini API keys.

The browser only receives short-lived session/bootstrap material when needed.

## Provider Keys And Ephemeral Credentials

This plugin expects the long-term provider keys to already exist inside OpenClaw.

Required providers:

- `openai`
- `google`

The real keys are resolved server-side from OpenClaw runtime auth/key-store support. They are not copied into the browser UI and they are not pasted by the user into the web page.

### OpenAI

For `OpenAI Realtime`, the plugin does this:

1. resolves the real OpenAI API key from OpenClaw
2. calls OpenAI:
   - `POST /v1/realtime/client_secrets`
3. returns the short-lived Realtime client secret payload to the browser
4. the browser uses that short-lived secret to open the WebRTC session

This is implemented in:

- [provider-routes.ts](/home/chris/.openclaw/plugins/browser-voice-gateway/routes/provider-routes.ts)
- [openai-provider.ts](/home/chris/.openclaw/plugins/browser-voice-gateway/providers/openai-provider.ts)

### Gemini

For `Gemini Live`, the plugin does this:

1. resolves the real Google API key from OpenClaw
2. uses the Google server-side SDK to mint a short-lived Gemini auth token
3. returns that token to the plugin-side Gemini bridge
4. the bridge uses that short-lived token when opening the Gemini Live provider socket

This is implemented in:

- [provider-routes.ts](/home/chris/.openclaw/plugins/browser-voice-gateway/routes/provider-routes.ts)
- [gemini-provider.ts](/home/chris/.openclaw/plugins/browser-voice-gateway/providers/gemini-provider.ts)
- [gemini-live-bridge.ts](/home/chris/.openclaw/plugins/browser-voice-gateway/providers/gemini-live-bridge.ts)

### Why Ephemeral Credentials Are Used

This is the more secure browser pattern.

Why:

- the long-term provider keys stay inside OpenClaw
- the browser gets short-lived credentials with limited lifetime
- if a short-lived credential leaks, the exposure window is much smaller
- the plugin can constrain what the short-lived credential is for
- trust, history, tools, and key custody stay on the OpenClaw side

In short:

- OpenClaw holds the real keys
- the browser gets temporary session/bootstrap credentials only
- OpenClaw remains the control plane

## Gemini SDK Usage

The plugin does use Google SDK code, but only on the server side for ephemeral token minting.

What is true today:

- the plugin uses the Google server-side SDK inside [gemini-provider.ts](/home/chris/.openclaw/plugins/browser-voice-gateway/providers/gemini-provider.ts) to create the ephemeral token
- the plugin does **not** use the Gemini browser SDK as the active live runtime path
- the active live runtime path is the plugin-side WebSocket bridge in [gemini-live-bridge.ts](/home/chris/.openclaw/plugins/browser-voice-gateway/providers/gemini-live-bridge.ts)

Why the browser SDK is not the live runtime path here:

- the direct browser Gemini path was unreliable on iPhone/WebKit
- the browser-side Gemini SDK path also caused browser dependency/runtime issues earlier during implementation
- the plugin-side bridge gave the more reliable mobile behavior

So the current runtime design is:

- browser -> plugin over your HTTPS origin
- plugin -> Gemini Live with a short-lived token

not:

- browser -> Gemini SDK live session directly

## Provider And Mode Overview

### Voice Page

The main page is:

- `/browser-voice/`

Voice modes available there:

- `OpenAI Realtime`
- `OpenAI Whisper`
- `Gemini Live`

### Chat Page

The separate chat page is:

- `/browser-voice/chat`

The chat page is intentionally simpler:

- text only
- no mode selector
- no record button
- uses the OpenClaw default model from `openclaw.json`
- currently expects that default model to be an OpenAI model

## Install

### Read This First About Paths

The JSON examples in this README use Linux absolute paths because this plugin was built and tested on Linux.

Use the same structure on your own machine, but change the path to match where your OpenClaw data directory lives.

The important idea is:

- this plugin folder must live inside your OpenClaw plugins directory
- the `plugins.load.paths` entry in `openclaw.json` must point at that folder

Linux example:

- `/home/<you>/.openclaw/plugins/browser-voice-gateway`

macOS example:

- `/Users/<you>/.openclaw/plugins/browser-voice-gateway`

Windows / WSL example:

- if you run OpenClaw inside WSL, use the Linux path inside WSL, for example:
  - `/home/<you>/.openclaw/plugins/browser-voice-gateway`
- if you run OpenClaw somewhere else, use that environment's actual OpenClaw directory

If your OpenClaw directory is not under `.openclaw`, use the real directory for your installation. The examples here are only examples of shape.

### 1. Put The Plugin In The Plugins Directory

Place this directory at:

- `/home/<you>/.openclaw/plugins/browser-voice-gateway/`

If you are packaging it for GitHub, the plugin directory should contain only the plugin source and docs. It should not contain scratch files or unused debug assets.

### 2. Install Plugin Dependencies

From inside the plugin directory, run:

```bash
cd /home/<you>/.openclaw/plugins/browser-voice-gateway
npm install
```

This plugin now owns its own Gemini-related dependencies. A fresh download should not rely on `gemini-provisioner` being present just to get `@google/genai` or `ws`.

### 3. Change The Browser Access Code

Do this before exposing the plugin to any real network.

The example access code in this plugin is generic. You should replace it with your own value in `openclaw.json`.

The setting is:

- `plugins.entries.browser-voice-gateway.config.browserAccessCode`

Example:

```json
"browserAccessCode": "replace-this-with-your-own-secret-code"
```

Important:

- do not keep the generic example value
- this is the code users enter in the browser to trust that browser
- it is not an OpenAI key
- it is not a Gemini key
- it is not the OpenClaw gateway token

Practical length rule from the current code:

- keep it at 256 characters or fewer

There is no stricter format requirement in the plugin code beyond being a non-empty string, so you can use letters, numbers, and punctuation if you want.

### 4. Make Sure OpenClaw Has Provider Auth

This plugin expects OpenClaw auth/key-store support for:

- `openai`
- `google`

The plugin resolves provider keys through OpenClaw runtime auth. The browser does not ask the user for provider API keys.

For the current text-chat, Whisper reasoning, and summary path, the OpenClaw default model should be an OpenAI model.

### 5. Edit `openclaw.json`

File:

- [openclaw.json](/home/chris/.openclaw/openclaw.json)

You need to update:

- `tools`
- `plugins.allow`
- `plugins.load.paths`
- `plugins.entries.browser-voice-gateway`

The plugin gets loaded in two places:

- `plugins.load.paths`
  - tells OpenClaw where the plugin folder lives on disk
- `plugins.entries.browser-voice-gateway`
  - tells OpenClaw to enable this plugin and what config to pass into it

### Exact Example

This is a safe example of the relevant shape. You do not need to replace your whole config with this, but your file needs equivalent blocks.

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "openai/gpt-4o-2024-11-20"
      }
    }
  },
  "tools": {
    "profile": "full",
    "deny": [
      "sessions_spawn",
      "sessions_send",
      "agents_list"
    ]
  },
  "plugins": {
    "allow": [
      "browser-voice-gateway"
    ],
    "load": {
      "paths": [
        "/home/<you>/.openclaw/plugins/browser-voice-gateway"
      ]
    },
    "entries": {
      "browser-voice-gateway": {
        "enabled": true,
        "config": {
          "enabled": true,
          "routeBase": "/browser-voice",
          "browserAccessCode": "replace-this-with-your-own-secret-code",
          "browserSessionTtlHours": 720,
          "defaultProvider": "openai",
          "openaiModel": "gpt-4o-mini-realtime-preview",
          "openaiVoice": "alloy",
          "geminiModel": "gemini-2.5-flash-native-audio-preview-12-2025",
          "sessionKey": "agent:main:browser-voice",
          "serve": {
            "enabled": true,
            "bind": "0.0.0.0",
            "port": 19443,
            "publicHost": "YOUR-LAN-IP-OR-HOSTNAME",
            "autoSelfSigned": true
          }
        }
      }
    }
  }
}
```

If the brackets feel confusing, use this rule:

- do not replace the whole file unless you already know what you are doing
- only add or update the specific blocks shown below
- keep the surrounding braces and commas from your existing file intact

Important:

- `openclaw.json` must stay valid JSON
- every `{` must have a matching `}`
- every `[` must have a matching `]`
- objects at the same level usually need commas between them
- one missing comma or closing brace can break OpenClaw startup or plugin loading

The safest way to edit it is:

1. find the existing top-level `plugins` object
2. add or update only the shown fields inside that object
3. make sure the object still closes exactly once
4. save the file and restart OpenClaw

If you already have other plugins configured, do not delete their blocks. Add `browser-voice-gateway` next to them inside the existing `plugins.entries` object.

### Where Each Block Goes

#### `tools`

This is a top-level block.

```json
"tools": {
  "profile": "full",
  "deny": [
    "sessions_spawn",
    "sessions_send",
    "agents_list"
  ]
}
```

This plugin reads the same global OpenClaw tools policy. That means browser sessions inherit the normal tool profile, while the denied tools above stay blocked.

#### `plugins.allow`

Inside the top-level `plugins` object:

```json
"plugins": {
  "allow": [
    "browser-voice-gateway"
  ]
}
```

#### `plugins.load.paths`

Inside the same `plugins` object:

```json
"plugins": {
  "load": {
    "paths": [
      "/home/<you>/.openclaw/plugins/browser-voice-gateway"
    ]
  }
}
```

This is the line that tells OpenClaw where the plugin folder is.

If you are on another machine, this path should be the absolute path to your own `browser-voice-gateway` folder.

#### `plugins.entries`

Inside the same `plugins` object:

```json
"plugins": {
  "entries": {
    "browser-voice-gateway": {
      "enabled": true,
      "config": {
        "enabled": true,
        "routeBase": "/browser-voice",
        "browserAccessCode": "replace-this-with-your-own-secret-code",
        "browserSessionTtlHours": 720,
        "defaultProvider": "openai",
        "openaiModel": "gpt-4o-mini-realtime-preview",
        "openaiVoice": "alloy",
        "geminiModel": "gemini-2.5-flash-native-audio-preview-12-2025",
        "sessionKey": "agent:main:browser-voice",
        "serve": {
          "enabled": true,
          "bind": "0.0.0.0",
          "port": 19443,
          "publicHost": "YOUR-LAN-IP-OR-HOSTNAME",
          "autoSelfSigned": true
        }
      }
    }
  }
}
```

This is the block that actually enables the plugin and gives it its runtime config.

If you already have other plugin entries, add `browser-voice-gateway` alongside them inside the same `plugins.entries` object.

### What The Important Plugin Config Fields Mean

`browserAccessCode`

- one-time trust code for the browser
- not an OpenAI key
- not a Gemini key
- not the OpenClaw gateway token

`browserSessionTtlHours`

- how long the trusted browser cookie lasts

`defaultProvider`

- first voice mode shown when the page loads

`openaiModel`

- OpenAI live voice model for `OpenAI Realtime`

`openaiVoice`

- OpenAI voice name used for live and STT/TTS playback

`geminiModel`

- Gemini live model used by the Gemini bridge

`sessionKey`

- base session key prefix for browser voice conversations
- actual per-conversation keys become:
  - `agent:main:browser-voice:<conversationId>`

`serve.bind`

- `0.0.0.0` makes the HTTPS server reachable from other devices on the network

`serve.publicHost`

- LAN IP or hostname the phone/browser should use

`serve.port`

- HTTPS port for the browser UI

`serve.autoSelfSigned`

- auto-generates a self-signed cert if no cert/key files are present

## Start It

After installing dependencies and updating `openclaw.json`, restart the gateway:

```bash
openclaw gateway restart
```

Then open:

- `https://<publicHost>:<port>/browser-voice/`

Example:

- `https://192.168.1.229:19443/browser-voice/`

## HTTPS And Mobile Trust

This plugin serves HTTPS because mobile browsers require secure contexts for microphone access.

Important distinction:

- HTTPS transport exists
- trusted HTTPS is whether the phone/browser actually trusts the certificate

If the certificate is self-signed, the page may still say `Not Secure` or the browser may behave inconsistently with microphone/audio access, especially on iPhone.

What that means in practice:

- HTTPS transport exists
- the phone still may not trust the certificate
- a self-signed certificate is useful for development, but it is not the same thing as a trusted production certificate

### Browser Guidance

Recommended first test browser:

- Chrome on mobile

Not recommended for initial testing:

- Safari on iPhone

Why Safari is not recommended first:

- Safari is stricter about certificate trust and secure-context behavior
- Safari is less forgiving when the certificate is self-signed or not fully trusted
- microphone and media behavior can fail earlier there

Important note:

- Chrome on iPhone still uses WebKit underneath
- so it is not fully separate from Safari behavior
- it was still the more practical test surface during this plugin build

### Silent Mode And iPhone Audio

For `OpenAI Whisper`, iPhone silent mode matters.

What was observed during testing:

- STT/TTS responses were being generated correctly
- browser playback could still be inaudible on iPhone when the phone was in silent mode

So if `OpenAI Whisper` appears to respond in text but you hear nothing on iPhone:

- turn silent mode off
- raise volume
- test again

This was a browser/device playback issue, not a failed STT/TTS response generation issue.

### If The Certificate Is Not Trusted

If the phone/browser does not trust the certificate:

- the page may say `Not Secure`
- microphone access may fail or behave inconsistently
- live audio behavior may degrade
- browser security behavior can differ between Safari and Chrome

The `What Is Trusted HTTPS?` button in Settings explains this in the UI.

For more detail see:

- [HTTPS_SETUP.md](/home/chris/.openclaw/plugins/browser-voice-gateway/HTTPS_SETUP.md)

That file is the dedicated HTTPS/trust companion document.

Use this README for installation and normal usage.

Use `HTTPS_SETUP.md` when you specifically need to understand:

- why the browser says `Not Secure`
- how to trust a local certificate
- how to think about reverse proxy / real TLS later

## Exact Runtime Flow

This section is the actual plugin flow, not a hand-wavy overview.

### Browser Trust Flow

1. User opens the browser page.
2. User enters the browser access code once.
3. Plugin validates the access code against:
   - `plugins.entries.browser-voice-gateway.config.browserAccessCode`
4. Plugin creates a trusted browser record.
5. Plugin sets an `HttpOnly` cookie.
6. Trusted browser data is stored at:
   - `/home/chris/.openclaw/browser-voice/trusted-browsers.json`

After that, the same browser usually does not need the code again until the cookie expires or is cleared.

### OpenAI Realtime Flow

1. Browser starts or resumes a conversation with `/api/session/start`.
2. Plugin creates or resolves a conversation record.
3. Browser requests `/api/bootstrap/openai`.
4. Plugin resolves the real OpenAI API key from OpenClaw auth.
5. Plugin calls OpenAI Realtime client-secret creation and receives a short-lived client secret.
6. Browser opens WebRTC directly to OpenAI.
7. Browser streams mic audio.
8. OpenAI streams audio back.
9. Transcript events are mirrored back into OpenClaw history.
10. On session end, the plugin summarizes the voice conversation and stores title + summary.

### OpenAI Whisper Flow

This is the turn-based audio mode.

1. User selects `OpenAI Whisper`.
2. User taps `Start`.
3. Browser opens a persistent local playback context and keeps the conversation alive on the page.
4. Main button becomes turn control:
   - tap to record
   - tap again to send
5. Browser uploads audio to `/api/chat/turn` with `mode: openai_stt_tts`.
6. Plugin:
   - transcribes with `whisper-1`
   - runs the text turn with the OpenClaw default model
   - synthesizes reply audio with `tts-1`
7. Browser shows the assistant text and plays returned speech.
8. `End` explicitly closes the Whisper session on the page.
9. On session end, the plugin summarizes the voice conversation and stores title + summary.

### Gemini Live Flow

Gemini is intentionally not raw browser-to-Gemini WebSocket on iPhone/WebKit because that path was unreliable.

The implemented shape is:

1. Browser starts or resumes a conversation with `/api/session/start`.
2. Browser opens a same-origin WebSocket to:
   - `/browser-voice/ws/gemini-live`
3. Plugin resolves the real Google API key from OpenClaw auth.
4. Plugin mints a short-lived Gemini token.
5. Plugin opens the Gemini Live provider socket with that short-lived token.
6. Plugin relays audio, text, tool calls, and transcription between browser and Gemini.
7. Plugin now injects prior context in two ways:
   - setup/system instruction
   - explicit initial text turn after setup completes
8. Plugin persists Gemini transcripts into OpenClaw history.
9. On session end, the plugin summarizes the voice conversation and stores title + summary.

## Where History Is Saved

There are three important storage layers.

### 1. Trusted Browser Records

Stored at:

- `/home/chris/.openclaw/browser-voice/trusted-browsers.json`

This tracks:

- trusted browser id
- browser label
- last seen time
- expiry

### 2. Conversation Metadata

Stored at:

- `/home/chris/.openclaw/browser-voice/conversations.json`

This tracks:

- conversation id
- title
- summary
- provider
- browser ownership
- device/shared mode
- timestamps
- preview
- linked OpenClaw session file

### 3. Full Transcript History

Stored in OpenClaw session files under:

- `/home/chris/.openclaw/agents/main/sessions/`

The plugin mirrors transcript entries into the same OpenClaw session-style storage used by the rest of the system.

This full transcript is the source of truth.

## How Continuity Works

Continuity is device-aware by default.

### `Latest`

- loads the most recent conversation for this browser/device
- does not open the history panel by itself

### `Browse History`

- opens the history panel
- lets the user select any accessible saved conversation

### Visible History vs Model History

These are intentionally not the same thing.

Visible UI history:

- loads the full saved thread into `Live Response` when a conversation is selected

Model context injection:

- sends the stored summary
- plus recent raw turns
- not the entire transcript

This keeps the UI useful for the human while keeping provider context smaller and cleaner.

## Summaries

Voice sessions use summary generation.

Text chat does not currently use this summarization flow.

### Automatic Summary Generation

On voice session end, the plugin:

1. reads the full non-synthetic transcript
2. sends it to the OpenClaw default text model path
3. asks for:
   - `Title:`
   - `Summary:`
4. stores:
   - title
   - summary up to 8 sentences

### Manual Summary Generation

In `Browse History`, the user can use:

- `Summarize Selected`

That is for older voice conversations that were created before summary support existed or for any conversation that needs to be refreshed manually.

### What Summary Is Used For

The stored summary is used for:

- better history display
- better continuity when reopening a voice conversation

## Web UI Guide

### Main Voice Page

URL:

- `/browser-voice/`

Controls:

`Voice Mode`

- `OpenAI Realtime`
- `OpenAI Whisper`
- `Gemini Live`

`Chat`

- opens the separate text chat page

`Latest`

- loads the most recent conversation for this device

`New`

- queues a new conversation
- next voice start uses a fresh conversation id

`Browse History`

- opens the history panel

`Live Response`

- shows the full visible thread for the currently selected conversation
- also shows current response text as it streams

`Settings`

- opens browser auth, diagnostics, theme, and session controls

`Logs`

- opens the in-page debug drawer if enabled

### OpenAI Realtime Button Behavior

- idle blue button
- turns live/red during active realtime session
- tap once to start
- tap again to end

### OpenAI Whisper Button Behavior

Whisper has a different interaction model.

Before session start:

- main button shows `Start`

After start:

- main button becomes turn control
- tap to record
- tap again to send
- `End` appears on the other side of the status bubble

`Play Last Reply`

- replays the last spoken Whisper response

`End`

- explicitly closes the current Whisper session on the page

### Chat Page

URL:

- `/browser-voice/chat`

Behavior:

- always text-only
- always uses the OpenClaw default model
- `Latest`, `New`, and `Browse History` behave the same way as on the voice page

## Diagnostics

Separate pages:

- `/browser-voice/trace`
- `/browser-voice/session-log`

In-page diagnostics:

- floating `Logs` button on the voice page
- controlled by `Log Display` in Settings

## Themes

The plugin includes:

- `Coast Glass`
- `Studio Slate`

Theme selection is stored in browser local storage and applies to both the voice and chat pages.

## What Uses The OpenClaw Default Model

The OpenClaw default model from:

- `agents.defaults.model.primary`

is used for:

- browser text chat
- Whisper STT/TTS text reasoning step
- voice conversation summarization

It is not used for:

- OpenAI Realtime media transport
- Gemini Live media transport

Current important limitation:

- browser text chat, Whisper reasoning, and summary generation currently expect the OpenClaw default model to be an OpenAI model
- if the default model is not an OpenAI model, those paths are not fully supported yet

## Tools

Browser sessions use the OpenClaw tool bridge.

The plugin exposes:

- `openclaw_tool`
- `write_file`

Actual tool availability still follows the global OpenClaw tools policy.

## Known Operational Notes

- iPhone silent mode can still affect browser audio playback.
- Self-signed HTTPS is not the same as trusted HTTPS.
- Safari on iPhone is not the recommended first test browser.
- Chrome on iPhone still uses WebKit underneath.
- Cloud-hosted OpenClaw deployments were not fully validated during this build.
- Local-network and self-hosted use were the primary tested path.
- The gateway may warn if the systemd service token is stale.
  - if needed:
  - `openclaw gateway install --force`

## Minimal Test Checklist

1. Restart the gateway.
2. Open the voice page.
3. Authenticate once with the browser access code.
4. Start `OpenAI Realtime` and confirm live voice works.
5. Start `OpenAI Whisper` and confirm turn-based voice works.
6. Start `Gemini Live` and confirm context continuity works on a summarized conversation.
7. Open `Browse History`.
8. Select a conversation and confirm full history loads into `Live Response`.
9. End a voice session and confirm title + summary update.
10. Use `Summarize Selected` on an older voice conversation and confirm it updates.

## License

This project is intended to be source-available for personal and noncommercial use.

Repository files:

- [LICENSE](/home/chris/.openclaw/plugins/browser-voice-gateway/LICENSE)
- [COMMERCIAL_LICENSE.md](/home/chris/.openclaw/plugins/browser-voice-gateway/COMMERCIAL_LICENSE.md)

Practical summary:

- noncommercial use is governed by the included license
- commercial use requires a separate commercial license from the repository owner

If you publish this on GitHub, do not use GitHub's auto-generated license picker for this repo. Create the repo with `No license` and commit the included `LICENSE` file yourself.

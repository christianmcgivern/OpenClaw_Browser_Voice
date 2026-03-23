# Browser Voice Gateway Quick Install

This is the simple version.

If you want the full technical details, read:

- [README.md](/home/chris/.openclaw/plugins/browser-voice-gateway/README.md)

## What You Need Before You Start

You need:

- OpenClaw already installed
- an OpenAI key saved in OpenClaw
- a Google Gemini key saved in OpenClaw
- this plugin folder copied into your OpenClaw plugins folder

This plugin does **not** ask the browser for your OpenAI or Gemini keys.

OpenClaw keeps those keys. The browser only gets short-lived temporary credentials.

## Where This Plugin Folder Goes

Put the folder here:

Linux:

- `/home/<you>/.openclaw/plugins/browser-voice-gateway`

macOS:

- `/Users/<you>/.openclaw/plugins/browser-voice-gateway`

Windows with WSL:

- use the Linux path inside WSL, for example:
  - `/home/<you>/.openclaw/plugins/browser-voice-gateway`

If your OpenClaw folder is somewhere else, use that real location.

## Step 1. Open The Plugin Folder In A Terminal

Example on Linux:

```bash
cd /home/<you>/.openclaw/plugins/browser-voice-gateway
```

## Step 2. Install The Plugin Dependencies

Run:

```bash
npm install
```

This installs the packages this plugin needs for Gemini support.

## Step 3. Change The Browser Access Code

Do not keep the generic example access code.

You should change it to your own value inside `openclaw.json`.

The setting is:

```json
"browserAccessCode": "replace-this-with-your-own-secret-code"
```

Important:

- users type this code into the web page to trust their browser
- it is not your OpenAI key
- it is not your Gemini key
- it is not your OpenClaw gateway token

Practical rule from the current code:

- keep it at 256 characters or fewer

There is no stricter character-format rule in the plugin code. It just needs to be a non-empty string.

## Step 4. Edit `openclaw.json`

Open your OpenClaw config file.

On Linux, it is usually here:

- `/home/<you>/.openclaw/openclaw.json`

On macOS, it is usually here:

- `/Users/<you>/.openclaw/openclaw.json`

On Windows with WSL, use the Linux path inside WSL.

### Add The Plugin Path

Inside the top-level `plugins.load.paths` list, add your plugin folder path.

Example:

```json
"plugins": {
  "load": {
    "paths": [
      "/home/<you>/.openclaw/plugins/browser-voice-gateway"
    ]
  }
}
```

### Allow The Plugin

Inside `plugins.allow`, add:

```json
"browser-voice-gateway"
```

### Add The Plugin Entry

Inside `plugins.entries`, add:

```json
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
```

## Step 5. Make Sure Your JSON Is Still Valid

This part matters.

If the braces or commas are wrong, OpenClaw can fail to load the config.

Check these things:

- every `{` has a matching `}`
- every `[` has a matching `]`
- items in lists and objects are separated with commas when needed
- you did not delete other plugins by accident

If you already have a `plugins` section, add to it. Do not replace the whole thing unless you mean to.

## Step 6. Restart OpenClaw Gateway

Run:

```bash
openclaw gateway restart
```

## Step 7. Open The Browser Page

Go to:

```text
https://YOUR-LAN-IP-OR-HOSTNAME:19443/browser-voice/
```

Example:

```text
https://192.168.1.50:19443/browser-voice/
```

## Step 8. Enter The Browser Access Code

The first time you open the page, it will ask for the browser access code.

That code is the value you put here in `openclaw.json`:

```json
"browserAccessCode": "replace-this-with-your-own-secret-code"
```

This is **not**:

- your OpenAI key
- your Gemini key
- your OpenClaw gateway token

It is only the one-time browser trust code for this plugin.

## Step 9. Start Using It

Voice page:

- `OpenAI Realtime`
- `OpenAI Whisper`
- `Gemini Live`

Chat page:

- `/browser-voice/chat`

## If The Browser Says `Not Secure`

That usually means the certificate is self-signed and the phone/browser does not trust it yet.

For quick local testing, you may still be able to continue.

What this means in practice:

- the page may load but still say `Not Secure`
- microphone access may fail or behave inconsistently
- iPhone Safari is the least forgiving option
- iPhone Chrome can still work, but it is still using WebKit under the hood

For the best results:

- use trusted HTTPS
- use Chrome first for testing
- avoid Safari on iPhone unless you specifically need to test it

## iPhone Note

For `OpenAI Whisper`, if you see text but hear no audio:

- turn silent mode off
- raise volume
- try again

## Fast Checklist

1. Copy plugin folder into OpenClaw plugins.
2. Run `npm install` inside the plugin folder.
3. Change `browserAccessCode` to your own value.
4. Add the plugin path to `plugins.load.paths`.
5. Add `browser-voice-gateway` to `plugins.allow`.
6. Add the `browser-voice-gateway` block to `plugins.entries`.
7. Save `openclaw.json`.
8. Restart OpenClaw gateway.
9. Open the HTTPS browser page.
10. Enter the browser access code.
11. Test voice or chat.

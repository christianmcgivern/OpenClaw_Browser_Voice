# HTTPS Setup

This plugin requires HTTPS for reliable mobile microphone access.

That requirement is especially important for:

- iPhone Safari
- iPad Safari
- Android browsers using `getUserMedia`

## Current Mode

Right now the plugin can auto-generate a self-signed certificate.

That gives you:

- encrypted HTTPS transport
- a working local HTTPS endpoint

It does not automatically give you:

- a browser-trusted certificate
- a clean mobile "secure" indicator
- guaranteed microphone permission behavior on phones

Important practical note:

- Chrome on iPhone still uses WebKit underneath
- Safari on iPhone is usually the stricter first-failure surface when trust is not correct
- Chrome on mobile was the more practical first test browser during this build

## Why The Browser Says "Not Secure"

Because the current certificate is self-signed, the browser does not trust the issuer by default.

This is a certificate trust problem, not a routing problem.

## Local Testing Options

### Option 1: Install Trust On The Device

Use a locally trusted CA such as `mkcert`, issue a cert for the host/IP you will use, and install/trust that CA on the phone.

This is the best local-network development path.

### Option 2: Accept The Warning Manually

This is only useful for quick inspection. It is not the right long-term path for mobile voice use.

Some devices and browsers will still refuse or inconsistently allow microphone access even if you manually continue past the warning.

## Production / Cloud Option

Use a real hostname and a CA-backed certificate.

Recommended shape:

1. assign a DNS name such as `voice.example.com`
2. put the plugin behind a reverse proxy such as Caddy or Nginx
3. terminate TLS at the proxy with Let's Encrypt
4. forward traffic to the plugin service running on the OpenClaw machine

This is the right path if the OpenClaw project is cloud-hosted or exposed beyond the LAN.

Important limitation:

- cloud-hosted OpenClaw deployments were not fully validated during this plugin build
- local-network and self-hosted usage were the primary tested path

## Relevant Config

In OpenClaw config:

- `plugins.entries.browser-voice-gateway.config.serve.enabled`
- `plugins.entries.browser-voice-gateway.config.serve.bind`
- `plugins.entries.browser-voice-gateway.config.serve.port`
- `plugins.entries.browser-voice-gateway.config.serve.publicHost`
- `plugins.entries.browser-voice-gateway.config.serve.certPath`
- `plugins.entries.browser-voice-gateway.config.serve.keyPath`
- `plugins.entries.browser-voice-gateway.config.serve.autoSelfSigned`

Current local-network values make the service reachable from other devices:

- `bind: 0.0.0.0`
- `publicHost: <your-lan-ip-or-hostname>`

That solves reachability. It does not solve certificate trust by itself.

## iPhone Silent Mode Note

For `OpenAI Whisper`, silent mode on iPhone can affect audible browser playback even when the STT/TTS response itself succeeded.

So if the web UI shows a valid Whisper response but you hear nothing:

- turn silent mode off
- raise the phone volume
- test again

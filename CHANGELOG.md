# Changelog

All notable changes to this project will be documented in this file.

## 0.1.0 - 2026-03-23

Initial public release.

### Added

- Browser and mobile HTTPS UI for OpenClaw voice access
- `OpenAI Realtime` live voice mode
- `OpenAI Whisper` turn-based voice mode using:
  - `whisper-1` for speech-to-text
  - the OpenClaw default text model for reasoning
  - `tts-1` for spoken playback
- `Gemini Live` mode through a plugin-side bridge
- Separate web text chat page using the OpenClaw default model
- Browser-side OpenClaw tool bridge with tool manifest and invocation routes
- Conversation history, device-aware continuity, and history browsing
- Voice session summarization with stored title and summary
- On-demand summarization for older voice conversations
- Built-in diagnostics:
  - session log page
  - tool trace page
  - in-page logs drawer
- Theme support:
  - `Coast Glass`
  - `Studio Slate`
- Dedicated install, integration, licensing, and AI-context documentation

### Changed

- Refactored the plugin into clearer modules for:
  - providers
  - routes
  - store
  - UI
- Moved Gemini dependency ownership into this plugin
- Removed runtime dependence on the old `gemini-provisioner` plugin
- Replaced machine-specific public doc examples with portable/public-safe wording
- Added README screenshots and cleaned repository structure for public release

### Notes

- Gemini tool declarations are now included in the constrained session bootstrap
- `gemini-provisioner` is no longer required for this plugin to bootstrap Gemini
- A current known issue remains for `Gemini Live` playback volume on some phones

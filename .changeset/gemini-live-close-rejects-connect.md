---
'@mastra/voice-google-gemini-live': patch
---

Fixed `GeminiLiveVoice.connect()` hanging for its full 30s setup timeout when the server closes the WebSocket during setup, for example a `1007` close for an unknown model id. An abnormal close (code other than `1000`) now emits an `error` event with code `websocket_closed` carrying the close code and reason, and the pending `connect()` rejects immediately with that reason instead of a generic "Session creation timeout".

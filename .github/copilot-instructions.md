# Copilot Code Review Instructions - pushbullet-sms-mcp

## Project Overview

MCP server for receiving SMS messages via Pushbullet WebSocket. Used by Claude Code for real-time 2FA code extraction from the user's phone.

## Architecture

- **Pattern:** MCP SDK handler pattern (stdio transport)
- **Runtime:** Node.js (CommonJS)
- **Dependencies:** `@modelcontextprotocol/sdk`, `ws` (WebSocket client)
- **Entry point:** `index.js` (single-file server)
- **Connection:** Pushbullet WebSocket stream for real-time SMS mirroring

## Security Focus

- `PUSHBULLET_API_TOKEN` must never be hardcoded - always from environment
- Never log full SMS content (may contain 2FA codes, personal messages)
- WebSocket URL contains API token - never log connection URLs
- Extracted verification codes should be used immediately, never stored
- API fallback (`fetch_sms_threads`) uses HTTPS only

## Code Patterns

### WebSocket
- Connect to `wss://stream.pushbullet.com/websocket/{token}`
- Listen for `push` events with `type: "sms_changed"`
- SMS data in `push.notifications[].body` and `push.notifications[].title`
- Auto-reconnect on connection loss

### 2FA Code Extraction
- Regex patterns for 4-8 digit codes
- Common formats: "Your code is 123456", "123456 is your verification code"
- Return first match from SMS body

### MCP Handlers
- `get_recent_sms` - Buffer of recent WebSocket messages
- `wait_for_sms` - Blocking wait with timeout and filters
- `extract_code_from_sms` - Regex-based code extraction
- `get_sms_status` - WebSocket connection health
- `fetch_sms_threads` - REST API fallback

## Common Pitfalls

- WebSocket may miss messages if server restarts - use `fetch_sms_threads` as fallback
- SMS timestamps from Pushbullet are Unix seconds (not milliseconds)
- 2FA codes expire quickly (30-60s) - always check timestamp freshness
- WebSocket heartbeat (`nop` messages) must not be treated as SMS data
- Buffer size is limited - old messages are evicted

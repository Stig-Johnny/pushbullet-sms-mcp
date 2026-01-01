# Pushbullet SMS MCP Server

MCP server for receiving SMS messages via Pushbullet for Claude Code automation. Enables real-time 2FA code extraction.

## Features

- Real-time SMS reception via Pushbullet WebSocket
- Automatic 2FA code extraction (4-8 digit patterns)
- Filter messages by sender
- Wait for incoming SMS with timeout
- Fallback API fetching if WebSocket misses messages

## Prerequisites

1. [Pushbullet](https://www.pushbullet.com/) account
2. Pushbullet Android app with SMS mirroring enabled
3. Pushbullet API access token

## Installation

```bash
cd ~/.claude/mcp-servers/pushbullet-sms
npm install
```

## Configuration

Set the `PUSHBULLET_API_TOKEN` environment variable:

```bash
export PUSHBULLET_API_TOKEN="your_api_token_here"
```

Or configure in your MCP settings with the env parameter.

## MCP Configuration

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "pushbullet-sms": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/.claude/mcp-servers/pushbullet-sms/index.js"],
      "env": {
        "PUSHBULLET_API_TOKEN": "your_token_here"
      }
    }
  }
}
```

## Tools

### `get_recent_sms`

Get recent SMS messages from the WebSocket stream.

**Parameters:**
- `limit` (optional): Max messages to return (default: 10)
- `sender` (optional): Filter by sender name (partial match)

### `wait_for_sms`

Wait for a new SMS message with optional filters.

**Parameters:**
- `timeout_seconds` (optional): How long to wait (default: 60)
- `sender` (optional): Filter by sender
- `contains` (optional): Filter by content
- `has_code` (optional): Only match messages with verification codes

### `extract_code_from_sms`

Extract a verification code from SMS text.

**Parameters:**
- `text` (required): The SMS text to parse

### `get_sms_status`

Get WebSocket connection status and message count.

### `fetch_sms_threads`

Fetch SMS directly from Pushbullet API (fallback).

**Parameters:**
- `limit` (optional): Max threads to fetch (default: 20)

## Usage Example

```javascript
// Wait for Google verification code
wait_for_sms({
  sender: "Google",
  has_code: true,
  timeout_seconds: 120
})
```

## Security

- API token is passed via environment variable, not hardcoded
- Messages are stored in memory only (not persisted)
- WebSocket connection uses secure WSS

## License

MIT

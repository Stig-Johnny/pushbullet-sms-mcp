#!/usr/bin/env node

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");
const WebSocket = require("ws");

// Configuration
const PUSHBULLET_API_TOKEN = process.env.PUSHBULLET_API_TOKEN;
const PUSHBULLET_WS_URL = `wss://stream.pushbullet.com/websocket/${PUSHBULLET_API_TOKEN}`;
const PUSHBULLET_API_BASE = "https://api.pushbullet.com/v2";

// Store for received SMS messages
const smsMessages = [];
const MAX_STORED_MESSAGES = 100;

// WebSocket connection
let ws = null;
let wsConnected = false;
let reconnectTimeout = null;

// Connect to Pushbullet WebSocket
function connectWebSocket() {
  if (ws) {
    try {
      ws.close();
    } catch (e) {}
  }

  console.error("[Pushbullet] Connecting to WebSocket...");

  ws = new WebSocket(PUSHBULLET_WS_URL);

  ws.on("open", () => {
    console.error("[Pushbullet] WebSocket connected");
    wsConnected = true;
  });

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handlePushbulletMessage(msg);
    } catch (e) {
      console.error("[Pushbullet] Error parsing message:", e.message);
    }
  });

  ws.on("close", () => {
    console.error("[Pushbullet] WebSocket closed, reconnecting in 5s...");
    wsConnected = false;
    reconnectTimeout = setTimeout(connectWebSocket, 5000);
  });

  ws.on("error", (err) => {
    console.error("[Pushbullet] WebSocket error:", err.message);
  });
}

// Handle incoming Pushbullet messages
function handlePushbulletMessage(msg) {
  // Tickle = something changed, fetch SMS
  if (msg.type === "tickle" && msg.subtype === "push") {
    console.error("[Pushbullet] Tickle received, fetching pushes...");
    fetchRecentPushes();
    return;
  }

  // Direct push with SMS
  if (msg.type === "push") {
    const push = msg.push;

    // SMS changed notification
    if (push && push.type === "sms_changed" && push.notifications) {
      for (const notif of push.notifications) {
        const sms = {
          id: `${notif.thread_id}_${Date.now()}`,
          sender: notif.title || "Unknown",
          body: notif.body || "",
          timestamp: new Date().toISOString(),
          threadId: notif.thread_id,
        };
        addSmsMessage(sms);
      }
    }

    // Mirror notification (SMS appears as mirror on some devices)
    if (push && push.type === "mirror" && push.package_name === "com.android.mms") {
      const sms = {
        id: `mirror_${Date.now()}`,
        sender: push.title || "Unknown",
        body: push.body || "",
        timestamp: new Date().toISOString(),
        app: push.application_name,
      };
      addSmsMessage(sms);
    }
  }
}

// Add SMS to store
function addSmsMessage(sms) {
  console.error(`[Pushbullet] SMS received from ${sms.sender}: ${sms.body.substring(0, 50)}...`);

  // Add to beginning of array
  smsMessages.unshift(sms);

  // Keep only MAX_STORED_MESSAGES
  while (smsMessages.length > MAX_STORED_MESSAGES) {
    smsMessages.pop();
  }
}

// Fetch recent pushes from API
async function fetchRecentPushes() {
  try {
    const response = await fetch(`${PUSHBULLET_API_BASE}/pushes?limit=10&active=true`, {
      headers: {
        "Access-Token": PUSHBULLET_API_TOKEN,
      },
    });

    if (!response.ok) {
      console.error("[Pushbullet] Failed to fetch pushes:", response.statusText);
      return;
    }

    const data = await response.json();

    // Process SMS pushes
    for (const push of data.pushes || []) {
      if (push.type === "sms_changed" && push.notifications) {
        for (const notif of push.notifications) {
          // Check if we already have this message
          const existingId = `${notif.thread_id}_${push.modified}`;
          if (!smsMessages.find(s => s.id === existingId)) {
            const sms = {
              id: existingId,
              sender: notif.title || "Unknown",
              body: notif.body || "",
              timestamp: new Date(push.modified * 1000).toISOString(),
              threadId: notif.thread_id,
            };
            addSmsMessage(sms);
          }
        }
      }
    }
  } catch (e) {
    console.error("[Pushbullet] Error fetching pushes:", e.message);
  }
}

// Extract verification code from text
function extractVerificationCode(text) {
  // Common patterns for 2FA codes
  const patterns = [
    /\b(\d{6})\b/,           // 6 digits
    /\b(\d{4})\b/,           // 4 digits
    /\b(\d{8})\b/,           // 8 digits
    /code[:\s]+(\d{4,8})/i,  // "code: 123456"
    /(\d{4,8})\s+is your/i,  // "123456 is your"
    /verify[:\s]+(\d{4,8})/i, // "verify: 123456"
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

// Wait for SMS with optional filter
async function waitForSms(filter = null, timeoutMs = 60000) {
  const startTime = Date.now();
  const startMessageCount = smsMessages.length;

  // Check existing messages first
  for (const sms of smsMessages) {
    if (!filter || matchesFilter(sms, filter)) {
      return sms;
    }
  }

  // Poll for new messages
  while (Date.now() - startTime < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Check for new messages
    for (let i = 0; i < smsMessages.length - startMessageCount + 5; i++) {
      const sms = smsMessages[i];
      if (!filter || matchesFilter(sms, filter)) {
        // Check if this is a new message (timestamp within last minute)
        const msgTime = new Date(sms.timestamp).getTime();
        if (msgTime > startTime - 60000) {
          return sms;
        }
      }
    }
  }

  return null;
}

// Check if SMS matches filter
function matchesFilter(sms, filter) {
  if (filter.sender && !sms.sender.toLowerCase().includes(filter.sender.toLowerCase())) {
    return false;
  }
  if (filter.contains && !sms.body.toLowerCase().includes(filter.contains.toLowerCase())) {
    return false;
  }
  if (filter.hasCode) {
    const code = extractVerificationCode(sms.body);
    if (!code) return false;
  }
  return true;
}

// Get device identifier for SMS
async function getDeviceIden() {
  try {
    const response = await fetch(`${PUSHBULLET_API_BASE}/devices`, {
      headers: {
        "Access-Token": PUSHBULLET_API_TOKEN,
      },
    });

    if (!response.ok) return null;

    const data = await response.json();
    // Find first device with SMS capability
    const smsDevice = data.devices?.find(d => d.has_sms && d.active);
    return smsDevice?.iden || null;
  } catch (e) {
    console.error("[Pushbullet] Error getting device:", e.message);
    return null;
  }
}

// Get SMS via REST API
async function fetchSmsFromApi(limit = 20) {
  try {
    // First get device identifier
    const deviceIden = await getDeviceIden();
    if (!deviceIden) {
      console.error("[Pushbullet] No SMS-capable device found");
      return [];
    }

    // Get SMS threads using device identifier
    const response = await fetch(`${PUSHBULLET_API_BASE}/permanents/${deviceIden}_threads`, {
      headers: {
        "Access-Token": PUSHBULLET_API_TOKEN,
      },
    });

    if (!response.ok) {
      // SMS feature might not be enabled
      return [];
    }

    const data = await response.json();
    const messages = [];

    for (const thread of (data.threads || []).slice(0, limit)) {
      if (thread.latest) {
        messages.push({
          id: thread.id,
          sender: thread.recipients?.[0]?.name || thread.recipients?.[0]?.number || "Unknown",
          body: thread.latest.body || "",
          timestamp: new Date(thread.latest.timestamp * 1000).toISOString(),
          threadId: thread.id,
        });
      }
    }

    return messages;
  } catch (e) {
    console.error("[Pushbullet] Error fetching SMS:", e.message);
    return [];
  }
}

// MCP Server
const server = new Server(
  {
    name: "pushbullet-sms",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_recent_sms",
        description: "Get recent SMS messages received via Pushbullet. Messages are stored from the WebSocket stream.",
        inputSchema: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description: "Maximum number of messages to return (default: 10)",
            },
            sender: {
              type: "string",
              description: "Filter by sender name (partial match)",
            },
          },
          required: [],
        },
      },
      {
        name: "wait_for_sms",
        description: "Wait for a new SMS message. Useful for receiving 2FA codes. Will poll for up to the specified timeout.",
        inputSchema: {
          type: "object",
          properties: {
            timeout_seconds: {
              type: "number",
              description: "How long to wait for SMS (default: 60 seconds)",
            },
            sender: {
              type: "string",
              description: "Only match SMS from this sender (partial match)",
            },
            contains: {
              type: "string",
              description: "Only match SMS containing this text",
            },
            has_code: {
              type: "boolean",
              description: "Only match SMS that appear to contain a verification code",
            },
          },
          required: [],
        },
      },
      {
        name: "extract_code_from_sms",
        description: "Extract a verification code from SMS text. Looks for common 2FA code patterns (4-8 digit numbers).",
        inputSchema: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "The SMS text to extract a code from",
            },
          },
          required: ["text"],
        },
      },
      {
        name: "get_sms_status",
        description: "Get the status of the Pushbullet SMS connection.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "fetch_sms_threads",
        description: "Fetch SMS threads directly from Pushbullet API. Use this if real-time messages aren't appearing.",
        inputSchema: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description: "Maximum number of threads to fetch (default: 20)",
            },
          },
          required: [],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "get_recent_sms": {
        const limit = args.limit || 10;
        let messages = smsMessages.slice(0, limit);

        if (args.sender) {
          messages = messages.filter(sms =>
            sms.sender.toLowerCase().includes(args.sender.toLowerCase())
          );
        }

        if (messages.length === 0) {
          return {
            content: [{
              type: "text",
              text: `No SMS messages found${args.sender ? ` from "${args.sender}"` : ""}. WebSocket connected: ${wsConnected}. Total stored: ${smsMessages.length}`,
            }],
          };
        }

        const formatted = messages.map(sms =>
          `[${sms.timestamp}] From: ${sms.sender}\n${sms.body}`
        ).join("\n\n---\n\n");

        return {
          content: [{
            type: "text",
            text: `Found ${messages.length} SMS message(s):\n\n${formatted}`,
          }],
        };
      }

      case "wait_for_sms": {
        const timeoutMs = (args.timeout_seconds || 60) * 1000;
        const filter = {};

        if (args.sender) filter.sender = args.sender;
        if (args.contains) filter.contains = args.contains;
        if (args.has_code) filter.hasCode = true;

        const filterDesc = Object.keys(filter).length > 0
          ? ` matching: ${JSON.stringify(filter)}`
          : "";

        console.error(`[Pushbullet] Waiting for SMS${filterDesc} (timeout: ${timeoutMs/1000}s)`);

        const sms = await waitForSms(
          Object.keys(filter).length > 0 ? filter : null,
          timeoutMs
        );

        if (!sms) {
          return {
            content: [{
              type: "text",
              text: `Timeout waiting for SMS${filterDesc}. No matching message received within ${timeoutMs/1000} seconds.`,
            }],
          };
        }

        const code = extractVerificationCode(sms.body);

        return {
          content: [{
            type: "text",
            text: `SMS received!\n\nFrom: ${sms.sender}\nTime: ${sms.timestamp}\nBody: ${sms.body}${code ? `\n\nExtracted code: ${code}` : ""}`,
          }],
        };
      }

      case "extract_code_from_sms": {
        const code = extractVerificationCode(args.text);

        if (!code) {
          return {
            content: [{
              type: "text",
              text: "No verification code found in the provided text.",
            }],
          };
        }

        return {
          content: [{
            type: "text",
            text: `Extracted verification code: ${code}`,
          }],
        };
      }

      case "get_sms_status": {
        return {
          content: [{
            type: "text",
            text: `Pushbullet SMS Status:
- WebSocket connected: ${wsConnected}
- Messages stored: ${smsMessages.length}
- Most recent: ${smsMessages[0]?.timestamp || "None"}
- API token configured: ${PUSHBULLET_API_TOKEN ? "Yes" : "No"}`,
          }],
        };
      }

      case "fetch_sms_threads": {
        const limit = args.limit || 20;
        const messages = await fetchSmsFromApi(limit);

        if (messages.length === 0) {
          return {
            content: [{
              type: "text",
              text: "No SMS threads found. Make sure SMS mirroring is enabled in the Pushbullet Android app.",
            }],
          };
        }

        // Add to our store
        for (const msg of messages) {
          if (!smsMessages.find(s => s.id === msg.id)) {
            smsMessages.push(msg);
          }
        }

        const formatted = messages.map(sms =>
          `[${sms.timestamp}] From: ${sms.sender}\n${sms.body}`
        ).join("\n\n---\n\n");

        return {
          content: [{
            type: "text",
            text: `Fetched ${messages.length} SMS thread(s):\n\n${formatted}`,
          }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Error: ${error.message}`,
      }],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  if (!PUSHBULLET_API_TOKEN) {
    console.error("PUSHBULLET_API_TOKEN is required. Set it as an environment variable.");
    process.exit(1);
  }

  // Connect to WebSocket for real-time SMS
  connectWebSocket();

  // Also fetch initial SMS
  fetchRecentPushes();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Pushbullet SMS MCP server running...");
}

main().catch(console.error);

const TOOLS = [
  {
    name: "bridge_status",
    description:
      "Report local bridge mode. Does not call Grok Bot. dot ingress is unconfigured and is not woken.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "list_inbox",
    description: "List authenticated callback events already stored locally. Does not fetch remotely.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 100 },
        correlation_id: { type: "string" },
      },
    },
  },
  {
    name: "read_inbox_event",
    description: "Read one stored callback event by event_id. Does not fetch remotely.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["event_id"],
      properties: { event_id: { type: "string" } },
    },
  },
];

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

export function handleMcp(message, ctx) {
  if (message == null || typeof message !== "object" || Array.isArray(message)) {
    return rpcError(null, -32600, "Invalid request");
  }
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return rpcError(message.id ?? null, -32600, "Invalid request");
  }
  if (message.method === "initialize") {
    return rpcResult(message.id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "grokbot-dot-bridge", version: "0.1.0" },
      instructions:
        "Read and list only. dot ingress is unconfigured; this server does not wake dot or contact Grok Bot.",
    });
  }
  if (message.method === "tools/list") {
    return rpcResult(message.id, { tools: TOOLS });
  }
  if (message.method !== "tools/call") {
    return rpcError(message.id, -32601, "Method not found");
  }
  const params = message.params;
  if (params == null || typeof params !== "object" || typeof params.name !== "string") {
    return rpcError(message.id, -32602, "Invalid params");
  }
  const args = params.arguments ?? {};
  if (args == null || typeof args !== "object" || Array.isArray(args)) {
    return rpcError(message.id, -32602, "Invalid params");
  }
  if (params.name === "wake_dot" || params.name === "ask_grokbot" || params.name === "dot_wake") {
    return rpcError(message.id, -32602, "Unknown tool");
  }
  if (params.name === "bridge_status") {
    if (Object.keys(args).length !== 0) return rpcError(message.id, -32602, "Invalid params");
    return rpcResult(message.id, {
      content: [{ type: "text", text: JSON.stringify(ctx.status()) }],
      isError: false,
      structured: ctx.status(),
    });
  }
  if (params.name === "list_inbox") {
    const allowed = new Set(["limit", "correlation_id"]);
    if (Object.keys(args).some((key) => !allowed.has(key))) {
      return rpcError(message.id, -32602, "Invalid params");
    }
    const listed = ctx.inbox.list({
      limit: args.limit ?? 20,
      correlation_id: args.correlation_id,
    });
    return rpcResult(message.id, {
      content: [{ type: "text", text: JSON.stringify(listed) }],
      isError: !listed.ok,
      structured: listed,
    });
  }
  if (params.name === "read_inbox_event") {
    if (Object.keys(args).some((key) => key !== "event_id")) {
      return rpcError(message.id, -32602, "Invalid params");
    }
    const read = ctx.inbox.read(args.event_id);
    return rpcResult(message.id, {
      content: [{ type: "text", text: JSON.stringify(read) }],
      isError: !read.ok,
      structured: read,
    });
  }
  return rpcError(message.id, -32602, "Unknown tool");
}

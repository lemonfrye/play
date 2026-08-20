const SERVER_INFO = {
  name: "bilibili-mcp",
  version: "1.0.0"
};

const TOOLS = [
  {
    name: "hello",
    description: "测试 MCP 连接",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "可选名称"
        }
      },
      additionalProperties: false
    }
  }
];

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "mcp-protocol-version": "2025-03-26",
      "access-control-allow-origin": "*",
      "access-control-allow-headers":
        "Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version",
      "access-control-allow-methods": "GET, POST, DELETE, OPTIONS"
    }
  });
}

function textResponse(text, status = 200) {
  return new Response(text, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "access-control-allow-origin": "*"
    }
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers":
            "Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version",
          "access-control-allow-methods": "GET, POST, DELETE, OPTIONS"
        }
      });
    }

    if (url.pathname !== "/mcp") {
      return textResponse("MCP server is running. Use /mcp");
    }

    if (request.method === "GET") {
      return textResponse("MCP endpoint is ready.");
    }

    if (request.method !== "POST") {
      return textResponse("Method Not Allowed", 405);
    }

    let message;

    try {
      message = await request.json();
    } catch {
      return response(
        {
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32700,
            message: "Invalid JSON"
          }
        },
        400
      );
    }

    if (message.method === "notifications/initialized") {
      return new Response(null, { status: 202 });
    }

    let result;

    if (message.method === "initialize") {
      result = {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {
            tools: {}
          },
          serverInfo: SERVER_INFO
        }
      };
    } else if (message.method === "ping") {
      result = {
        jsonrpc: "2.0",
        id: message.id,
        result: {}
      };
    } else if (message.method === "tools/list") {
      result = {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          tools: TOOLS
        }
      };
    } else if (message.method === "tools/call") {
      const toolName = message.params?.name;
      const args = message.params?.arguments ?? {};

      if (toolName !== "hello") {
        result = {
          jsonrpc: "2.0",
          id: message.id,
          error: {
            code: -32602,
            message: `Unknown tool: ${toolName}`
          }
        };
      } else {
        result = {
          jsonrpc: "2.0",
          id: message.id,
          result: {
            content: [
              {
                type: "text",
                text: `MCP 连接成功${args.name ? `，你好，${args.name}` : ""}！`
              }
            ]
          }
        };
      }
    } else {
      result = {
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32601,
          message: `Method not found: ${message.method}`
        }
      };
    }

    return response(result);
  }
};

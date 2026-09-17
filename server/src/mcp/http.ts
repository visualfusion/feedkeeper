import { Router } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { requireBearerToken } from "../auth/middleware.js";
import { createMcpServerForUser } from "./server.js";

export const mcpRouter = Router();

// Stateless mode: a fresh McpServer + transport per request, scoped to the
// user resolved from the bearer token. This is what makes the same endpoint
// safely usable by many different users/clients from anywhere.
mcpRouter.post("/", requireBearerToken, async (req, res) => {
  try {
    const server = createMcpServerForUser(req.user!.id);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("[mcp] request failed", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

mcpRouter.get("/", requireBearerToken, (_req, res) => {
  res.status(405).set("Allow", "POST").json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed. This server only supports stateless POST requests." },
    id: null,
  });
});

mcpRouter.delete("/", requireBearerToken, (_req, res) => {
  res.status(405).set("Allow", "POST").json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  });
});

#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { prepareEnvironment } from "./cli.js";

// Ensure stdout is exclusively reserved for MCP JSON-RPC messages.
console.log = console.error;
console.info = console.error;

export async function runMcpStdio(): Promise<void> {
  const envFile = resolve(process.cwd(), ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  prepareEnvironment({ action: "start", forwarded: [] }, process.env);

  const { runMigrations } = await import("./db/index.js");
  runMigrations();

  const { getOrCreateDefaultUser } = await import("./auth/users.js");
  const { createMcpServerForUser } = await import("./mcp/server.js");

  const user = getOrCreateDefaultUser();
  const server = createMcpServerForUser(user.id, "write");
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("mcp-stdio.js")) {
  runMcpStdio().catch((error: unknown) => {
    console.error("mcp-stdio error:", error);
    process.exit(1);
  });
}

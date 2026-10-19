#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { HELP, UsageError, parseArgs, prepareEnvironment } from "./cli.js";
import { APP_VERSION } from "./version.js";

// Everything that reads the settings is imported only after the environment is complete: the configuration
// module validates SESSION_SECRET the moment it loads.
async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.action === "help") return void console.log(HELP);
  if (options.action === "version") return void console.log(APP_VERSION);

  const envFile = resolve(process.cwd(), ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const prepared = prepareEnvironment(options, process.env);

  if (options.action === "backup" || options.action === "restore") {
    process.argv.splice(2, process.argv.length, ...options.forwarded);
    await import("./backup-cli.js");
    return;
  }

  console.log(`[feedkeeper] version ${APP_VERSION}, data in ${prepared.dataDir}`);
  if (prepared.secretCreated) console.log(`[feedkeeper] created a session secret at ${prepared.secretPath}; keep it with your backups`);
  await import("./server.js");
}

main().catch((error: unknown) => {
  if (error instanceof UsageError) {
    console.error(`feedkeeper: ${error.message}\nRun "feedkeeper --help" for usage.`);
    process.exitCode = 2;
  } else {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
});

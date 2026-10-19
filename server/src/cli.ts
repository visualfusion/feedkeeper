import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const HELP = `FeedKeeper: a self-hosted RSS reader and remote MCP server

Usage:
  feedkeeper [options]                   Start the server
  feedkeeper backup <file>               Back up the database (see docs for restore)
  feedkeeper restore <file> --force      Restore the database from a backup

Options:
  --port <number>        Port to listen on (default: 3000, or PORT)
  --public-url <url>     Address people reach this instance at (default: http://localhost:<port>)
  --data-dir <folder>    Where the database, archive and session secret live
                         (default: the folder of DATABASE_PATH, otherwise ~/.feedkeeper)
  -v, --version          Print the version
  -h, --help             Print this help

A .env file in the current folder is read first; real environment variables win over it.
Without SESSION_SECRET, one is generated on first start and kept in the data folder.
All other settings are the environment variables of .env.example in the repository.`;

export type CliAction = "start" | "backup" | "restore" | "help" | "version";

export interface CliOptions {
  action: CliAction;
  port?: number;
  publicUrl?: string;
  dataDir?: string;
  /** The arguments for the backup and restore commands, starting with the command itself. */
  forwarded: string[];
}

export class UsageError extends Error {}

function takeValue(argv: string[], index: number, flag: string): [string, number] {
  const argument = argv[index]!;
  const inline = argument.indexOf("=");
  if (inline !== -1) return [argument.slice(inline + 1), index];
  const next = argv[index + 1];
  if (next === undefined || next.startsWith("-")) throw new UsageError(`${flag} needs a value`);
  return [next, index + 1];
}

/** Turns the command line into options, or throws a UsageError that says what is wrong. */
export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { action: "start", forwarded: [] };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!;
    const name = argument.split("=")[0];
    if (argument === "-h" || argument === "--help") return { ...options, action: "help" };
    if (argument === "-v" || argument === "--version") return { ...options, action: "version" };
    if (name === "--port") {
      const [value, next] = takeValue(argv, index, "--port");
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new UsageError(`--port must be a number from 1 to 65535, got "${value}"`);
      options.port = port;
      index = next;
    } else if (name === "--public-url") {
      const [value, next] = takeValue(argv, index, "--public-url");
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        throw new UsageError(`--public-url must be an address such as https://feeds.example.org, got "${value}"`);
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new UsageError(`--public-url must start with http:// or https://, got "${value}"`);
      options.publicUrl = value.replace(/\/+$/, "");
      index = next;
    } else if (name === "--data-dir") {
      const [value, next] = takeValue(argv, index, "--data-dir");
      options.dataDir = value;
      index = next;
    } else if (options.action === "start" && (argument === "backup" || argument === "restore")) {
      options.action = argument;
      options.forwarded.push(argument);
    } else if (options.action !== "start" && (argument === "--force" || !argument.startsWith("-"))) {
      // The file name and --force belong to the backup tool; options above are the only ones read here.
      options.forwarded.push(argument);
    } else {
      throw new UsageError(`Unknown ${argument.startsWith("-") ? "option" : "command"} "${argument}"`);
    }
  }
  return options;
}

export interface PreparedEnvironment {
  dataDir: string;
  /** True when this start created the session secret, so the caller can tell the operator where it lives. */
  secretCreated: boolean;
  secretPath: string | null;
}

/**
 * Fills the settings the server needs and an operator should not have to think about on a first start: a data
 * folder, the database path, the public address that follows the port, and a session secret. Values that are
 * already set are never replaced, apart from the ones given as options.
 */
export function prepareEnvironment(
  options: CliOptions,
  env: NodeJS.ProcessEnv,
  home: string = homedir(),
  persist: boolean = options.action === "start",
): PreparedEnvironment {
  if (options.port !== undefined) env.PORT = String(options.port);
  if (options.publicUrl !== undefined) env.PUBLIC_URL = options.publicUrl;
  if (!env.PUBLIC_URL?.trim()) env.PUBLIC_URL = `http://localhost:${env.PORT?.trim() || 3000}`;

  const configured = env.DATABASE_PATH?.trim();
  const dataDir = resolve(
    options.dataDir ?? (env.FEEDKEEPER_DATA_DIR?.trim() || (configured ? dirname(resolve(configured)) : join(home, ".feedkeeper"))),
  );
  if (!configured || options.dataDir !== undefined) env.DATABASE_PATH = join(dataDir, "feedkeeper.sqlite");
  if (persist) mkdirSync(dirname(resolve(env.DATABASE_PATH!)), { recursive: true, mode: 0o700 });

  let secretCreated = false;
  let secretPath: string | null = null;
  if (!env.SESSION_SECRET?.trim()) {
    secretPath = join(dataDir, "session-secret");
    const read = () => (existsSync(secretPath!) ? readFileSync(secretPath!, "utf8").trim() : "");
    let secret = read();
    if (!secret && !persist) {
      // Backup and restore never sign anything, but the configuration insists on a secret: a throwaway one, not stored.
      env.SESSION_SECRET = randomBytes(32).toString("hex");
      return { dataDir, secretCreated: false, secretPath: null };
    }
    if (!secret) {
      mkdirSync(dataDir, { recursive: true, mode: 0o700 });
      try {
        writeFileSync(secretPath, `${randomBytes(32).toString("hex")}\n`, { flag: "wx", mode: 0o600 });
        secretCreated = true;
      } catch (error) {
        // Another process created it in the meantime: use theirs.
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      secret = read();
    }
    if (!secret) throw new Error(`Could not read or create the session secret at ${secretPath}`);
    env.SESSION_SECRET = secret;
  }

  env.NODE_ENV ??= "production";
  return { dataDir, secretCreated, secretPath };
}

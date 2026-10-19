import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { UsageError, parseArgs, prepareEnvironment } from "../src/cli.js";

const scratch = mkdtempSync(join(tmpdir(), "feedkeeper-cli-"));
after(() => rmSync(scratch, { recursive: true, force: true }));
const folder = (name: string) => join(scratch, name);
const options = (argv: string[] = []) => parseArgs(argv);

test("without arguments the server starts, and help and version are recognised", () => {
  assert.equal(options().action, "start");
  assert.equal(options(["-h"]).action, "help");
  assert.equal(options(["--help", "--port", "x"]).action, "help", "help wins before anything else is checked");
  assert.equal(options(["--version"]).action, "version");
  assert.equal(options(["-v"]).action, "version");
});

test("port, public address and data folder come as separate or joined values", () => {
  assert.deepEqual(
    { ...options(["--port", "8080", "--public-url", "https://feeds.example.org/", "--data-dir", "/srv/fk"]), forwarded: [] },
    { action: "start", port: 8080, publicUrl: "https://feeds.example.org", dataDir: "/srv/fk", forwarded: [] },
  );
  const joined = options(["--port=8081", "--public-url=http://nas:8081", "--data-dir=./data"]);
  assert.equal(joined.port, 8081);
  assert.equal(joined.publicUrl, "http://nas:8081");
  assert.equal(joined.dataDir, "./data");
});

test("wrong or missing values are reported by name instead of being guessed", () => {
  for (const [argv, expected] of [
    [["--port"], /--port needs a value/],
    [["--port", "0"], /1 to 65535/],
    [["--port", "70000"], /1 to 65535/],
    [["--port", "abc"], /1 to 65535/],
    [["--public-url", "not a url"], /--public-url must be an address/],
    [["--public-url", "ftp://example.org"], /http:\/\/ or https:\/\//],
    [["--data-dir"], /--data-dir needs a value/],
    [["--data-dir", "--port"], /--data-dir needs a value/],
    [["--nope"], /Unknown option "--nope"/],
    [["serve"], /Unknown command "serve"/],
  ] as Array<[string[], RegExp]>) {
    assert.throws(() => options(argv), (error: unknown) => error instanceof UsageError && expected.test(error.message), argv.join(" "));
  }
});

test("backup and restore pass their file and --force on, and the options work before or after the command", () => {
  const before = options(["--data-dir", "/srv/fk", "backup", "/tmp/out.sqlite"]);
  assert.deepEqual([before.action, before.dataDir, before.forwarded], ["backup", "/srv/fk", ["backup", "/tmp/out.sqlite"]]);
  const after = options(["backup", "/tmp/out.sqlite", "--data-dir", "/srv/fk"]);
  assert.deepEqual([after.action, after.dataDir, after.forwarded], ["backup", "/srv/fk", ["backup", "/tmp/out.sqlite"]]);
  const restore = options(["restore", "/tmp/out.sqlite", "--force"]);
  assert.equal(restore.action, "restore");
  assert.deepEqual(restore.forwarded, ["restore", "/tmp/out.sqlite", "--force"]);
  assert.throws(() => options(["backup", "/tmp/out.sqlite", "--nope"]), /Unknown option "--nope"/);
  assert.deepEqual(options(["backup", "restore"]).forwarded, ["backup", "restore"], "a second command word is just a file name to the tool");
});

test("backup and restore write nothing: no folder, no secret file", () => {
  const home = folder("backup-home");
  const env: NodeJS.ProcessEnv = {};
  const prepared = prepareEnvironment(options(["backup", "/tmp/x.sqlite"]), env, home);
  assert.equal(existsSync(join(home, ".feedkeeper")), false);
  assert.equal(prepared.secretCreated, false);
  assert.equal(prepared.secretPath, null);
  assert.match(env.SESSION_SECRET!, /^[0-9a-f]{64}$/, "a throwaway secret satisfies the configuration");
  // An existing secret is used as it is.
  const real: NodeJS.ProcessEnv = {};
  prepareEnvironment(options(), real, home);
  const again: NodeJS.ProcessEnv = {};
  prepareEnvironment(options(["restore", "/tmp/x.sqlite", "--force"]), again, home);
  assert.equal(again.SESSION_SECRET, real.SESSION_SECRET);
});

test("a first start gets a data folder, a database path, a public address and its own session secret", () => {
  const home = folder("first-home");
  const env: NodeJS.ProcessEnv = {};
  const prepared = prepareEnvironment(options(), env, home);
  assert.equal(prepared.dataDir, join(home, ".feedkeeper"));
  assert.equal(env.DATABASE_PATH, join(home, ".feedkeeper", "feedkeeper.sqlite"));
  assert.equal(env.PUBLIC_URL, "http://localhost:3000");
  assert.equal(env.NODE_ENV, "production");
  assert.equal(prepared.secretCreated, true);
  assert.match(env.SESSION_SECRET!, /^[0-9a-f]{64}$/);
  assert.equal(readFileSync(prepared.secretPath!, "utf8").trim(), env.SESSION_SECRET);
  if (process.platform !== "win32") assert.equal(statSync(prepared.secretPath!).mode & 0o777, 0o600, "only the owner reads the secret");
});

test("the next start reuses the secret, so sessions survive a restart", () => {
  const home = folder("again-home");
  const first: NodeJS.ProcessEnv = {};
  prepareEnvironment(options(), first, home);
  const second: NodeJS.ProcessEnv = {};
  const prepared = prepareEnvironment(options(), second, home);
  assert.equal(prepared.secretCreated, false);
  assert.equal(second.SESSION_SECRET, first.SESSION_SECRET);
});

test("settings the operator made are never replaced", () => {
  const home = folder("set-home");
  const own = folder("own-data");
  const env: NodeJS.ProcessEnv = {
    SESSION_SECRET: "an-operator-secret-of-more-than-thirty-two-characters",
    DATABASE_PATH: join(own, "reader.sqlite"),
    PUBLIC_URL: "https://feeds.example.org",
    PORT: "4000",
    NODE_ENV: "development",
  };
  const prepared = prepareEnvironment(options(), env, home);
  assert.equal(env.SESSION_SECRET, "an-operator-secret-of-more-than-thirty-two-characters");
  assert.equal(env.DATABASE_PATH, join(own, "reader.sqlite"));
  assert.equal(env.PUBLIC_URL, "https://feeds.example.org");
  assert.equal(env.NODE_ENV, "development");
  assert.equal(prepared.secretCreated, false);
  assert.equal(prepared.secretPath, null, "no file is written when a secret is configured");
});

test("with a configured database but no secret, the secret is kept next to the database", () => {
  const data = folder("docker-data");
  const env: NodeJS.ProcessEnv = { DATABASE_PATH: join(data, "feedkeeper.sqlite"), SESSION_SECRET: "  " };
  const prepared = prepareEnvironment(options(), env, folder("unused-home"));
  assert.equal(prepared.secretPath, join(data, "session-secret"));
  assert.match(env.SESSION_SECRET!, /^[0-9a-f]{64}$/);
});

test("options win over the environment, and the public address follows the port", () => {
  const env: NodeJS.ProcessEnv = { PORT: "3000", PUBLIC_URL: "http://old:3000" };
  prepareEnvironment(options(["--port", "9000", "--public-url", "http://nas:9000", "--data-dir", folder("flag-data")]), env, folder("h"));
  assert.equal(env.PORT, "9000");
  assert.equal(env.PUBLIC_URL, "http://nas:9000");
  assert.equal(env.DATABASE_PATH, join(folder("flag-data"), "feedkeeper.sqlite"));

  const followed: NodeJS.ProcessEnv = { SESSION_SECRET: "s".repeat(40) };
  prepareEnvironment(options(["--port", "9100"]), followed, folder("h2"));
  assert.equal(followed.PUBLIC_URL, "http://localhost:9100");
});

test("an empty public address counts as unset", () => {
  const env: NodeJS.ProcessEnv = { SESSION_SECRET: "s".repeat(40), PUBLIC_URL: "  ", PORT: "" };
  prepareEnvironment(options(), env, folder("empty-home"));
  assert.equal(env.PUBLIC_URL, "http://localhost:3000");
});

test("an existing but empty secret file is not accepted as a secret", () => {
  const home = folder("empty-secret-home");
  const env1: NodeJS.ProcessEnv = {};
  const prepared = prepareEnvironment(options(), env1, home);
  writeFileSync(prepared.secretPath!, "\n");
  const env2: NodeJS.ProcessEnv = {};
  // The file exists, so it is not rewritten: the start must fail loudly rather than run with an empty secret.
  assert.throws(() => prepareEnvironment(options(), env2, home), /Could not read or create the session secret/);
});

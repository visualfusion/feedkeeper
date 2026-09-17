import { stdin, stdout } from "node:process";
import { runMigrations, hasAnyUser } from "./db/index.js";
import { createUser } from "./auth/users.js";

// Alternative to the in-browser onboarding screen: creates the first admin
// user from the terminal, e.g. right after deploying on a fresh server.
//
// A single persistent stdin listener maintains the current line and echoes
// it (masked for the password prompt), one character at a time. This avoids
// the classic bug of mixing readline.question() with ad-hoc raw-mode reads,
// where switching prompts mid-stream can drop already-buffered input.
const isTty = stdin.isTTY === true;
let line = "";
let masked = false;
const pendingLines: string[] = [];
let lineReady: ((value: string) => void) | null = null;

if (isTty) stdin.setRawMode?.(true);
stdin.resume();
stdin.setEncoding("utf8");

stdin.on("data", (chunk: string) => {
  for (const char of chunk) {
    if (char === "") {
      stdout.write("\n");
      process.exit(1);
    }
    if (char === "\n" || char === "\r") {
      const value = line;
      line = "";
      stdout.write("\n");
      if (lineReady) {
        const resolve = lineReady;
        lineReady = null;
        resolve(value);
      } else {
        // Answer arrived before the next prompt started asking for it
        // (e.g. buffered/piped input) — queue it instead of dropping it.
        pendingLines.push(value);
      }
      continue;
    }
    if (char === "" || char === "\b") {
      if (line.length > 0) {
        line = line.slice(0, -1);
        stdout.write("\b \b");
      }
      continue;
    }
    line += char;
    if (masked) stdout.write("*");
    else if (!isTty) stdout.write(char); // piped input isn't echoed by the terminal itself
  }
});

function readLine(question: string, opts: { mask?: boolean } = {}): Promise<string> {
  stdout.write(question);
  masked = Boolean(opts.mask);
  const queued = pendingLines.shift();
  if (queued !== undefined) {
    stdout.write(`${queued}\n`);
    return Promise.resolve(queued.trim());
  }
  return new Promise((resolve) => {
    lineReady = (value) => resolve(value.trim());
  });
}

async function main(): Promise<void> {
  runMigrations();

  if (hasAnyUser()) {
    console.log("An admin user already exists. Use the web UI to manage additional accounts.");
    process.exit(0);
  }

  console.log("Feedkeeper setup — create the first admin account.\n");
  const email = await readLine("Admin email: ");
  const displayName = await readLine("Display name: ");

  let password = "";
  while (password.length < 10) {
    password = await readLine("Password (min. 10 characters): ", { mask: true });
    if (password.length < 10) console.log("Password too short, try again.");
  }

  const user = createUser({ email, password, displayName, role: "admin" });
  console.log(`\nAdmin account "${user.email}" created. You can now log in at your Feedkeeper URL.`);
  process.exit(0);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    if (isTty) stdin.setRawMode?.(false);
    stdin.pause();
  });

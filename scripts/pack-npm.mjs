// Assembles the npm package "feedkeeper" in dist-npm/ from the build output, so that `npx feedkeeper` runs the
// server without a clone or a build. The package is generated rather than kept as a workspace: its dependencies
// are exactly those of server/package.json, so the two can never drift apart.
//
//   npm run build && npm run pack:npm
//   npm publish ./dist-npm        (as the package owner, with two-factor authentication)
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist-npm");
const readJson = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));

const requiredBuild = ["server/dist/feedkeeper.js", "server/dist/server.js", "server/dist/db/migrations", "web/dist/index.html"];
const missing = requiredBuild.filter((path) => !existsSync(join(root, path)));
if (missing.length > 0) {
  console.error(`The build is incomplete (${missing.join(", ")}). Run "npm run build" first.`);
  process.exit(1);
}

const rootPackage = readJson("package.json");
const serverPackage = readJson("server/package.json");

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "server"), { recursive: true });
// Sourcemaps and type declarations are of no use when the server only runs.
const runtimeOnly = (source) => !/\.(map|d\.ts)$/.test(source);
cpSync(join(root, "server/dist"), join(out, "server/dist"), { recursive: true, filter: runtimeOnly });
cpSync(join(root, "web/dist"), join(out, "web/dist"), { recursive: true });
cpSync(join(root, "LICENSE"), join(out, "LICENSE"));

// The compiled server reads its version and its module type from the package.json next to dist/.
writeFileSync(
  join(out, "server/package.json"),
  `${JSON.stringify({ name: serverPackage.name, version: rootPackage.version, private: true, type: "module" }, null, 2)}\n`,
);

const manifest = {
  name: "feedkeeper",
  version: rootPackage.version,
  description: "A lightweight, self-hosted RSS reader and remote MCP server for your news, blogs, and AI workflows.",
  keywords: ["rss", "atom", "feed-reader", "self-hosted", "mcp", "model-context-protocol", "sqlite"],
  license: rootPackage.license,
  homepage: "https://github.com/visualfusion/feedkeeper#readme",
  repository: rootPackage.repository,
  bugs: { url: "https://github.com/visualfusion/feedkeeper/issues" },
  bin: { feedkeeper: "server/dist/feedkeeper.js" },
  engines: rootPackage.engines,
  files: ["server", "web", "LICENSE", "README.md"],
  dependencies: serverPackage.dependencies,
};
writeFileSync(join(out, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);

writeFileSync(
  join(out, "README.md"),
  `# FeedKeeper

A lightweight, self-hosted RSS reader and remote MCP server. One Node process, one SQLite file.

\`\`\`bash
npx feedkeeper
\`\`\`

Open <http://localhost:3000> and finish the setup in the browser. The database, the archive of saved
articles and a generated session secret live in \`~/.feedkeeper\`.

\`\`\`text
feedkeeper [--port <number>] [--public-url <url>] [--data-dir <folder>]
feedkeeper backup <file>
feedkeeper restore <file> --force
\`\`\`

Requires Node.js ${rootPackage.engines.node}. A \`.env\` file in the current folder is read; the settings
are the ones of [.env.example](https://github.com/visualfusion/feedkeeper/blob/main/.env.example).

Documentation, Docker images and the changelog: <https://github.com/visualfusion/feedkeeper>

MIT licensed.
`,
);

console.log(`Package assembled in dist-npm/ (feedkeeper@${manifest.version}).`);
console.log("Check it with:  npm pack ./dist-npm --dry-run");
console.log("Publish with:   npm publish ./dist-npm");

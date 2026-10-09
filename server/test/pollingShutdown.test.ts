import assert from "node:assert/strict";
import { test } from "node:test";
import { fork } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

function start(databasePath: string, url: string, resume: boolean) {
  const child = fork(new URL("./fixtures/poll-worker.ts",import.meta.url),[],{execArgv:["--import","tsx"],stdio:["ignore","ignore","pipe","ipc"],env:{
    ...process.env,DATABASE_PATH:databasePath,ARCHIVE_PATH:join(databasePath,"..","archive"),
    SESSION_SECRET:"shutdown-test-secret-at-least-32-characters",ALLOW_PRIVATE_FEEDS:"true",TEST_FEED_URL:url,TEST_RESUME:String(resume),
    POLL_REQUEST_TIMEOUT_MS:"2000",POLL_ATTEMPT_TIMEOUT_MS:"3000",
  }});
  const exit = new Promise<number | null>(done => child.once("exit",done));
  return { child, exit };
}

test("SIGTERM cancels an unfinished poll and a fresh process resumes its durable job", {timeout:15000}, async () => {
  const directory=mkdtempSync(join(tmpdir(),"feedkeeper-poll-shutdown-"));
  const path=join(directory,"state.sqlite");
  let allow=false; let feeds=0; let started!:()=>void;
  const fetching=new Promise<void>(done => { started=done; });
  const source=createServer((req,res) => {
    if (req.url!=="/feed") return res.writeHead(404).end();
    feeds++; started();
    if (allow) res.end('<rss version="2.0"><channel><title>Restart</title><item><guid>one</guid><title>One</title></item></channel></rss>');
  });
  await new Promise<void>(done => source.listen(0,"127.0.0.1",done));
  const url=`http://127.0.0.1:${(source.address() as AddressInfo).port}/feed`;
  const first=start(path,url,false);
  let second: ReturnType<typeof start> | undefined;
  try {
    await fetching;
    first.child.kill("SIGTERM");
    assert.equal(await first.exit,0);
    let db=new Database(path);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM feed_poll_jobs").get()!.n,1);
    assert.equal(db.prepare("SELECT last_polled_at FROM feeds").get()!.last_polled_at,null);
    db.close();
    allow=true; second=start(path,url,true);
    const result=await new Promise<{newItems:number;error:string|null}>(done => second!.child.on("message",message => {
      if ((message as {type:string}).type==="result") done(message as {newItems:number;error:string|null});
    }));
    assert.equal(result.newItems,1); assert.equal(result.error,null);
    second.child.kill("SIGTERM"); assert.equal(await second.exit,0);
    db=new Database(path);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM feed_poll_jobs").get()!.n,0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM items").get()!.n,1);
    db.close(); assert.equal(feeds,2);
  } finally {
    first.child.kill("SIGKILL"); second?.child.kill("SIGKILL");
    source.closeAllConnections(); await new Promise<void>(done => source.close(() => done()));
    rmSync(directory,{recursive:true,force:true});
  }
});

test("SIGTERM finishes one push delivery; a fresh process resumes all other recipients without repeating completed devices", { timeout: 15000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "feedkeeper-push-shutdown-"));
  const path = join(directory, "state.sqlite");
  const children: ReturnType<typeof fork>[] = [];
  const sent: string[] = [];
  function worker(resume: boolean) {
    const child = fork(new URL("./fixtures/push-worker.ts", import.meta.url), [], {
      execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"],
      env: { ...process.env, DATABASE_PATH: path, SESSION_SECRET: "push-restart-test-secret-at-least-32-characters", TEST_RESUME: String(resume) },
    });
    children.push(child);
    const exit = new Promise<number | null>(done => child.once("exit", done));
    const completed = new Promise<void>(done => child.on("message", raw => {
      const message = raw as { type: string; device: string };
      if (message.type === "delivery") {
        sent.push(message.device);
        if (!resume) { child.kill("SIGTERM"); done(); }
      }
      if (message.type === "done") done();
    }));
    return { child, exit, completed };
  }
  try {
    const first = worker(false);
    await first.completed;
    assert.equal(await first.exit, 0);
    const saved = new Database(path);
    assert.equal(saved.prepare("SELECT COUNT(*) n FROM push_outbox").get()!.n, 1);
    assert.ok(Number(saved.prepare("SELECT device_cursor FROM push_outbox").get()!.device_cursor) > 0);
    saved.close();
    assert.equal(sent.length, 1);
    const second = worker(true);
    await second.completed; second.child.kill("SIGTERM");
    assert.equal(await second.exit, 0);
    assert.equal(sent.length, 6); assert.equal(new Set(sent).size, 6);
    const restored = new Database(path);
    assert.equal(restored.prepare("SELECT COUNT(*) n FROM push_outbox").get()!.n, 0);
    restored.close();
  } finally {
    for (const child of children) child.kill("SIGKILL");
    rmSync(directory, { recursive: true, force: true });
  }
});

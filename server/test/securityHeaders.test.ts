import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import helmet from "helmet";
import { securityHeaderOptions } from "../src/securityHeaders.js";

async function headersFor(publicUrl: string) {
  const app = express();
  app.use(helmet(securityHeaderOptions(publicUrl)));
  app.get("/", (_req, res) => void res.send("ok"));
  const server = app.listen(0);
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
    return response.headers;
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

test("a plain http address does not upgrade its own requests to https", async () => {
  for (const url of ["http://localhost:3000", "http://192.168.1.20:3000", "http://raspberrypi.local:3000"]) {
    const headers = await headersFor(url);
    assert.doesNotMatch(headers.get("content-security-policy") ?? "", /upgrade-insecure-requests/, url);
    assert.equal(headers.get("strict-transport-security"), null, url);
  }
});

test("an https address keeps the upgrade and HSTS headers", async () => {
  const headers = await headersFor("https://feeds.example.org");
  assert.match(headers.get("content-security-policy") ?? "", /upgrade-insecure-requests/);
  assert.match(headers.get("strict-transport-security") ?? "", /max-age=/);
});

test("the content security policy stays strict on both", async () => {
  for (const url of ["http://localhost:3000", "https://feeds.example.org"]) {
    const policy = (await headersFor(url)).get("content-security-policy") ?? "";
    assert.match(policy, /script-src 'self'/, url);
    assert.match(policy, /object-src 'none'/, url);
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { readFileSync } from "node:fs";

const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://reader.example" });
for (const key of ["window", "document", "HTMLElement", "HTMLInputElement", "Event", "MouseEvent"]) globalThis[key] = dom.window[key];
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
globalThis.PublicKeyCredential = class {};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const { SecuritySettings } = await import("../src/components/settings/SecuritySettings.tsx");
const i18n = createInstance();
await i18n.use(initReactI18next).init({ lng: "de", resources: { de: { translation: JSON.parse(readFileSync(new URL("../src/i18n/locales/de.json", import.meta.url), "utf8")) } }, interpolation: { escapeValue: false } });

async function fixture({ failRegistration = false, failRefresh = false, email = false } = {}) {
  let saved = false, totpEnabled = false;
  const requests = [];
  const passkeys = [{ id: "first", name: "iCloud", created_at: "2026-10-12" }];
  globalThis.navigator.credentials = {
    create: async () => ({ id: "second", rawId: new Uint8Array([1]).buffer, type: "public-key", response: { attestationObject: new ArrayBuffer(1), clientDataJSON: new ArrayBuffer(1) }, getClientExtensionResults: () => ({}) }),
    get: async () => ({ id: "first", rawId: new Uint8Array([1]).buffer, type: "public-key", response: { authenticatorData: new ArrayBuffer(1), clientDataJSON: new ArrayBuffer(1), signature: new ArrayBuffer(1) }, getClientExtensionResults: () => ({}) }),
  };
  globalThis.fetch = async (url, options = {}) => {
    const path = url.replace("/api/auth/security", "");
    const body = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ path, body, method: options.method });
    if (path === "/") return Response.json(saved && failRefresh ? { error: "refresh_failed" } : { passkeys, passkeysEnabled: true, totpEnabled, recoveryCodesRemaining: 0, emailReauthEnabled: email }, { status: saved && failRefresh ? 503 : 200 });
    if (path === "/reauth" || path === "/reauth/email/confirm") return Response.json({ reauthToken: "one-use-proof" });
    if (path === "/reauth/passkey/options") return Response.json({ challengeId: "reauth-challenge", publicKey: { challenge: "AAECAw", rpId: "reader.example" } });
    if (path === "/reauth/passkey/verify") return Response.json({ reauthToken: "passkey-proof" });
    if (path === "/totp/setup") return Response.json({ challengeId: "setup", secret: "TEST-ONLY", uri: "otpauth://totp/Reader?secret=TESTONLY" });
    if (path === "/totp/confirm") { totpEnabled = true; return Response.json({ recoveryCodes: ["test-only-recovery"] }); }
    if (path === "/reauth/email") return new Response(null, { status: 204 });
    if (path === "/passkeys/register/options") return Response.json({ challengeId: "registration", publicKey: { challenge: "AAECAw", rp: { id: "reader.example", name: "Reader" }, user: { id: "AQ", name: "reader", displayName: "Reader" }, pubKeyCredParams: [{ type: "public-key", alg: -7 }] } });
    if (path === "/passkeys/register/verify") {
      if (failRegistration) return Response.json({ error: "registration_failed" }, { status: 400 });
      passkeys.push({ id: "second", name: body.name, created_at: "2026-10-12" }); saved = true;
      return new Response(null, { status: 204 });
    }
    if (path === "/passkeys/second" && options.method === "DELETE") { passkeys.pop(); return new Response(null, { status: 204 }); }
    throw new Error(`Unexpected request ${path}`);
  };
  const root = createRoot(document.getElementById("root"));
  await act(async () => { root.render(React.createElement(I18nextProvider, { i18n }, React.createElement(SecuritySettings))); });
  return { requests, cleanup: async () => { await act(async () => root.unmount()); } };
}
const button = text => [...document.querySelectorAll("button")].find(node => node.textContent === text);
const field = name => [...document.querySelectorAll("input")].find(node => node.getAttribute("aria-label") === name || node.closest("label")?.textContent === name);
async function fill(input, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(node) { assert.ok(node); await act(async () => node.click()); }
async function waitFor(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  }
  assert.fail("The expected security state did not appear");
}
async function add() {
  await fill(field("Name des Passkeys"), "  Laptop  ");
  await click(button("Passkey hinzufügen"));
  await fill(field("Aktuelles Passwort"), "test-password");
  await click(button("Bestätigen"));
}

test("adding a passkey reports success, clears identity fields and requires a fresh proof for a later change", async () => {
  const f = await fixture();
  try {
    await add();
    assert.match(document.querySelector('[role="status"]').textContent, /Passkey wurde hinzugefügt/);
    assert.ok(!document.querySelector('[role="alert"]'));
    assert.ok(!field("Aktuelles Passwort"));
    assert.equal(field("Name des Passkeys").value, "");
    assert.deepEqual([...document.querySelectorAll("li span")].map(node => node.textContent), ["iCloud", "Laptop"]);
    assert.equal(f.requests.filter(r => r.path === "/reauth").length, 1, "no repeated identity request after saving");
    await click(document.querySelector('button[aria-label="Passkey „Laptop“ entfernen"]'));
    assert.equal(field("Aktuelles Passwort").value, "");
    assert.ok(document.activeElement === field("Aktuelles Passwort"), "the new proof field receives focus");
    assert.equal(f.requests.filter(r => r.path === "/reauth").length, 1, "opening identity confirmation does not reuse or submit empty proof");
    await fill(field("Aktuelles Passwort"), "fresh-password");
    await click(button("Bestätigen"));
    assert.equal(f.requests.filter(r => r.path === "/reauth").length, 2);
    assert.equal(document.querySelector('[role="status"]').textContent, "Der Passkey wurde entfernt.");
  } finally { await f.cleanup(); }
});

test("a rejected registration retains the form and reports no success", async () => {
  const f = await fixture({ failRegistration: true });
  try {
    await add();
    assert.ok(document.querySelector('[role="alert"]'));
    assert.ok(!document.querySelector('[role="status"]'));
    assert.equal(field("Name des Passkeys").value, "  Laptop  ");
    assert.ok(!field("Aktuelles Passwort"));
  } finally { await f.cleanup(); }
});

test("a saved passkey followed by a failed refresh is still reported as saved", async () => {
  const f = await fixture({ failRefresh: true });
  try {
    await add();
    assert.match(document.querySelector('[role="status"]').textContent, /Passkey wurde hinzugefügt/);
    assert.match(document.querySelector('[role="alert"]').textContent, /Änderung wurde gespeichert/);
    assert.ok(!field("Aktuelles Passwort"));
    assert.equal(f.requests.filter(r => r.path === "/passkeys/register/verify").length, 1);
  } finally { await f.cleanup(); }
});

test("requesting an email proof keeps confirmation open until the security change succeeds", async () => {
  const f = await fixture({ email: true });
  try {
    await fill(field("Name des Passkeys"), "Laptop");
    await click(button("Passkey hinzufügen"));
    assert.ok(button("Per E-Mail bestätigen (Konten ohne Passwort)"));
    await click(button("Per E-Mail bestätigen (Konten ohne Passwort)"));
    assert.ok(field("E-Mail-Bestätigungscode"));
    assert.ok(!document.querySelector('[role="status"]'));
    await fill(field("E-Mail-Bestätigungscode"), "12345678");
    await click(button("Bestätigen"));
    assert.ok(!field("E-Mail-Bestätigungscode"));
    assert.equal(f.requests.find(r => r.path === "/reauth/email/confirm").body.emailCode, "12345678");
    assert.match(document.querySelector('[role="status"]').textContent, /hinzugefügt/);
  } finally { await f.cleanup(); }
});

test("authenticator setup stays pending until the code is confirmed", async () => {
  const f = await fixture();
  try {
    await click(button("Authenticator einrichten"));
    await fill(field("Aktuelles Passwort"), "test-password");
    await click(button("Bestätigen"));
    await waitFor(() => document.querySelector('[role="status"]'));
    assert.match(document.querySelector('[role="status"]').textContent, /Einrichtung wurde gestartet/);
    assert.ok(field("Authenticator- oder Wiederherstellungscode"));
    assert.ok(!field("Aktuelles Passwort"));
    await fill(field("Authenticator- oder Wiederherstellungscode"), "123456");
    await click(button("Einrichtung bestätigen"));
    assert.ok(!field("Authenticator- oder Wiederherstellungscode"));
    assert.match(document.body.textContent, /test-only-recovery/);
    assert.equal(f.requests.filter(r => r.path === "/reauth").length, 1);
    assert.equal(f.requests.find(r => r.path === "/totp/confirm").body.code, "123456");
  } finally { await f.cleanup(); }
});

test("confirming a protected action with an existing passkey skips password entry", async () => {
  const f = await fixture();
  try {
    await click(button("Authenticator einrichten"));
    assert.ok(button("Mit Passkey bestätigen"));
    await click(button("Mit Passkey bestätigen"));
    await waitFor(() => document.querySelector('[role="status"]'));
    assert.match(document.querySelector('[role="status"]').textContent, /Einrichtung wurde gestartet/);
    assert.equal(f.requests.filter(r => r.path === "/reauth/passkey/options").length, 1);
    assert.equal(f.requests.filter(r => r.path === "/reauth/passkey/verify").length, 1);
    assert.equal(f.requests.filter(r => r.path === "/reauth").length, 0, "no password reauth needed");
  } finally { await f.cleanup(); }
});

test("cancelling the confirmation dialog leaves the form unchanged and reports no error", async () => {
  const f = await fixture();
  try {
    await fill(field("Name des Passkeys"), "Tablet");
    await click(button("Passkey hinzufügen"));
    assert.ok(field("Aktuelles Passwort"));
    await click(button("Abbrechen"));
    assert.ok(!field("Aktuelles Passwort"));
    assert.ok(!document.querySelector('[role="alert"]'));
    assert.ok(!document.querySelector('[role="status"]'));
    assert.equal(field("Name des Passkeys").value, "Tablet");
    assert.equal(f.requests.filter(r => r.path === "/reauth").length, 0);
  } finally { await f.cleanup(); }
});

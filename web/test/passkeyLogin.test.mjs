import assert from "node:assert/strict";
import { test } from "node:test";
import { createPasskeyLogin } from "../src/api/passkeyLogin.ts";

const settle = () => new Promise(resolve => setImmediate(resolve));
const credential = () => ({
  id: "credential", type: "public-key", rawId: new Uint8Array([1, 2]).buffer,
  getClientExtensionResults: () => ({}),
  response: { clientDataJSON: new Uint8Array([3]).buffer, authenticatorData: new Uint8Array([4]).buffer,
    signature: new Uint8Array([5]).buffer, userHandle: new Uint8Array([6]).buffer },
});
function fixture(t, available = true) {
  const saved = ["window", "navigator"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const requests = [], ceremonies = [], events = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: { PublicKeyCredential: { isConditionalMediationAvailable: async () => available } } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { credentials: { get: options => new Promise(resolve => ceremonies.push({ options, resolve })) } } });
  t.after(() => { for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  const options = { challengeId: "challenge", publicKey: { challenge: "AQID", rpId: "feeds.example.org", userVerification: "required", allowCredentials: [{ id: "AQI", type: "public-key" }] } };
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push({ url, init, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => options };
  });
  const login = createPasskeyLogin({
    remember: () => true,
    onAutofill: value => events.push(["autofill", value]),
    onSelect: () => events.push(["select"]),
    onSuccess: async () => { events.push(["success"]); },
    onError: () => events.push(["error"]),
  });
  t.after(login.stop);
  return { login, requests, ceremonies, events, options };
}

test("passkey autofill lifecycle", async t => {
  await t.test("waits without blocking passwords and verifies a selected discoverable credential", async t => {
    const f = fixture(t);
    const pending = f.login.start();
    await settle();
    await f.login.start();
    assert.equal(f.ceremonies.length, 1, "focus does not create another ceremony");
    const { options, resolve } = f.ceremonies[0];
    assert.equal(options.mediation, "conditional");
    assert.deepEqual(options.publicKey.allowCredentials, []);
    assert.equal(options.publicKey.userVerification, "required");
    assert.deepEqual([...new Uint8Array(options.publicKey.challenge)], [1, 2, 3]);
    assert.deepEqual(f.events, [["autofill", true]]);
    resolve(credential()); await pending;
    assert.deepEqual(f.events, [["autofill", true], ["select"], ["success"]]);
    assert.equal(f.requests[1].body.challengeId, "challenge");
    assert.equal(f.requests[1].body.credential.response.signature, "BQ");
    assert.equal(f.requests[1].body.credential.response.userHandle, "Bg");
  });
  await t.test("unsupported browsers get a manual route without a background request", async t => {
    const f = fixture(t, false);
    await f.login.start();
    assert.deepEqual(f.events, [["autofill", false]]);
    assert.equal(f.requests.length, 0);
    const pending = f.login.start(false); await settle();
    assert.equal(f.ceremonies[0].options.mediation, undefined);
    f.ceremonies[0].resolve(credential()); await pending;
    assert.equal(f.events.at(-1)[0], "success");
  });
  await t.test("password submission or navigation prevents a late assertion from signing in", async t => {
    const f = fixture(t);
    const pending = f.login.start(); await settle();
    f.login.stop();
    assert.equal(f.ceremonies[0].options.signal.aborted, true);
    f.ceremonies[0].resolve(credential()); await pending;
    assert.equal(f.requests.length, 1, "no verification after cancellation");
    assert.deepEqual(f.events, [["autofill", true]]);
  });
  await t.test("leaving during the options request cannot start stale browser UI", async t => {
    const f = fixture(t);
    let release;
    t.mock.method(globalThis, "fetch", () => new Promise(resolve => { release = resolve; }));
    const pending = f.login.start(); await settle();
    f.login.stop(); release({ ok: true, status: 200, json: async () => f.options });
    await pending;
    assert.equal(f.ceremonies.length, 0);
  });
  await t.test("refreshes a waiting challenge before its five minute expiry", async t => {
    const f = fixture(t);
    let renew;
    t.mock.method(globalThis, "setTimeout", (callback, ms) => { assert.equal(ms, 240_000); renew = callback; return 1; });
    const pending = f.login.start(); await settle();
    renew(); await settle();
    assert.equal(f.ceremonies.length, 2);
    assert.equal(f.ceremonies[0].options.signal.aborted, true);
    f.ceremonies[0].resolve(credential()); await pending;
    f.login.stop(); f.ceremonies[1].resolve(null); await settle();
    assert.equal(f.events.some(([event]) => event === "success"), false);
  });
  await t.test("a failed verification leaves the form usable and reports an error", async t => {
    const f = fixture(t);
    const pending = f.login.start(); await settle();
    t.mock.method(globalThis, "fetch", async () => ({ ok: false, status: 401, json: async () => ({ error: "invalid_credentials" }) }));
    f.ceremonies[0].resolve(credential()); await pending;
    assert.equal(f.events.at(-1)[0], "error");
  });
  await t.test("cancelling the picker is quiet and the email field can start again", async t => {
    const f = fixture(t);
    t.mock.method(globalThis.navigator.credentials, "get", async () => { throw new DOMException("Cancelled", "NotAllowedError"); });
    await f.login.start();
    assert.deepEqual(f.events, [["autofill", true]]);
    await f.login.start();
    assert.equal(f.requests.length, 2);
  });
  await t.test("cancellation during verification ignores a late server response", async t => {
    const f = fixture(t);
    const pending = f.login.start(); await settle();
    let release;
    t.mock.method(globalThis, "fetch", (_url, init) => new Promise(resolve => { release = resolve; f.requests.push({ init }); }));
    f.ceremonies[0].resolve(credential()); await settle();
    f.login.stop();
    assert.equal(f.requests.at(-1).init.signal.aborted, true);
    release({ ok: true, status: 200, json: async () => ({}) }); await pending;
    assert.deepEqual(f.events, [["autofill", true], ["select"]]);
  });

});

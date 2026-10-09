import type { Request } from "express";

type Lang = "en" | "de" | "ja";

const strings = {
  en: {
    passkey: "Use a passkey",
    loginTitle: "Sign in to FeedKeeper",
    loginIntro: "{client} wants to connect to your FeedKeeper account. Sign in to continue.",
    email: "Email",
    password: "Password",
    signIn: "Sign in",
    badLogin: "Email or password is wrong.",
    consentTitle: "Allow access?",
    consentIntro: "{client} wants to access your FeedKeeper account through MCP.",
    returnsTo: "After you decide, you are sent back to {host}.",
    readOnly: "Read only",
    readOnlyHint: "Look up feeds and articles. Changes nothing.",
    readWrite: "Read and write",
    readWriteHint: "Also mark articles read, bookmark, and manage feeds and folders.",
    allow: "Allow",
    deny: "Deny",
    signedInAs: "Signed in as {user}",
    errorTitle: "This request cannot be completed",
    unknownClient: "The app is not registered with this server.",
    badRedirect: "The return address does not match the app's registration.",
    noAccess: "Your account does not include MCP access.",
    manage: "Manage your plan",
    forbidden: "The request came from another site and was blocked.",
  },
  de: {
    passkey: "Mit Passkey anmelden",
    loginTitle: "Bei FeedKeeper anmelden",
    loginIntro: "{client} möchte sich mit deinem FeedKeeper-Konto verbinden. Melde dich an, um fortzufahren.",
    email: "E-Mail",
    password: "Passwort",
    signIn: "Anmelden",
    badLogin: "E-Mail oder Passwort ist falsch.",
    consentTitle: "Zugriff erlauben?",
    consentIntro: "{client} möchte über MCP auf dein FeedKeeper-Konto zugreifen.",
    returnsTo: "Nach deiner Entscheidung geht es zurück zu {host}.",
    readOnly: "Nur lesen",
    readOnlyHint: "Feeds und Artikel abrufen. Ändert nichts.",
    readWrite: "Lesen und schreiben",
    readWriteHint: "Zusätzlich Artikel als gelesen markieren, merken sowie Feeds und Ressorts verwalten.",
    allow: "Erlauben",
    deny: "Ablehnen",
    signedInAs: "Angemeldet als {user}",
    errorTitle: "Die Anfrage kann nicht abgeschlossen werden",
    unknownClient: "Die App ist bei diesem Server nicht registriert.",
    badRedirect: "Die Rücksprungadresse passt nicht zur Registrierung der App.",
    noAccess: "Dein Konto enthält keinen MCP-Zugriff.",
    manage: "Tarif verwalten",
    forbidden: "Die Anfrage kam von einer anderen Website und wurde blockiert.",
  },
  ja: {
    passkey: "パスキーでサインイン",
    loginTitle: "FeedKeeperにサインイン",
    loginIntro: "{client} がFeedKeeperアカウントへの接続を求めています。続けるにはサインインしてください。",
    email: "メールアドレス",
    password: "パスワード",
    signIn: "サインイン",
    badLogin: "メールアドレスまたはパスワードが正しくありません。",
    consentTitle: "アクセスを許可しますか？",
    consentIntro: "{client} がMCP経由でFeedKeeperアカウントにアクセスしようとしています。",
    returnsTo: "選択後は {host} に戻ります。",
    readOnly: "読み取りのみ",
    readOnlyHint: "フィードと記事を参照します。変更はしません。",
    readWrite: "読み取りと書き込み",
    readWriteHint: "記事の既読化、ブックマーク、フィードとフォルダの管理も行えます。",
    allow: "許可",
    deny: "拒否",
    signedInAs: "{user} としてサインイン中",
    errorTitle: "このリクエストは完了できません",
    unknownClient: "このアプリはこのサーバーに登録されていません。",
    badRedirect: "戻り先のアドレスがアプリの登録と一致しません。",
    noAccess: "お使いのアカウントにはMCPアクセスが含まれていません。",
    manage: "プランを管理",
    forbidden: "別のサイトからのリクエストのためブロックしました。",
  },
} as const;

export type MessageKey = keyof (typeof strings)["en"];

function languageOf(req: Request): Lang {
  const header = String(req.headers["accept-language"] ?? "").toLowerCase();
  for (const part of header.split(",")) {
    const tag = part.trim().slice(0, 2);
    if (tag === "de" || tag === "ja" || tag === "en") return tag;
  }
  return "en";
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function text(lang: Lang, key: MessageKey, values: Record<string, string> = {}): string {
  const template: string = strings[lang][key];
  return escapeHtml(template.replace(/\{(\w+)\}/g, (_match, name: string) => values[name] ?? ""));
}

function layout(lang: Lang, title: string, body: string): string {
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${title}</title>
<style>
:root{--bg:#f6f7f8;--card:#fff;--text:#1d2329;--muted:#5c6770;--line:#d9dee2;--accent:#3d5a73;--accent-text:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#14181c;--card:#1e242a;--text:#e8ecef;--muted:#9aa6b0;--line:#323a42;--accent:#8fb0cc;--accent-text:#10161b}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;background:var(--bg);color:var(--text);font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif}
main{width:100%;max-width:420px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px}
h1{font-size:1.35rem;margin:0 0 8px}p{margin:0 0 16px}.muted{color:var(--muted);font-size:.9rem}
label.field{display:block;font-weight:600;font-size:.9rem;margin-bottom:12px}
input[type=email],input[type=password]{display:block;width:100%;margin-top:4px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--text);font:inherit}
.choice{display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px solid var(--line);border-radius:12px;margin-bottom:10px;cursor:pointer}
.choice input{margin-top:4px}.choice strong{display:block}.choice span{color:var(--muted);font-size:.88rem}
.row{display:flex;gap:10px;margin-top:20px}button{flex:1;padding:11px 14px;border-radius:10px;border:1px solid var(--line);background:transparent;color:var(--text);font:inherit;font-weight:600;cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-text)}.error{color:#b3261e}a{color:var(--accent)}
</style></head><body><main>${body}</main></body></html>`;
}

export function hidden(name: string, value: string): string {
  return `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`;
}

export function renderLogin(req: Request, input: { clientName: string; returnTo: string; failed?: boolean }): string {
  const lang = languageOf(req);
  return layout(lang, text(lang, "loginTitle"), `
<h1>${text(lang, "loginTitle")}</h1>
<p>${text(lang, "loginIntro", { client: input.clientName })}</p>
${input.failed ? `<p class="error" role="alert">${text(lang, "badLogin")}</p>` : ""}
<form method="post" action="/oauth/authorize/login">
${hidden("return_to", input.returnTo)}
<label class="field">${text(lang, "email")}<input type="email" name="email" required autofocus autocomplete="username"></label>
<label class="field">${text(lang, "password")}<input type="password" name="password" required autocomplete="current-password"></label>
<div class="row"><button class="primary" type="submit">${text(lang, "signIn")}</button></div>
</form>
<p><a href="/login?next=${encodeURIComponent(input.returnTo)}">${text(lang, "passkey")}</a></p>`);
}

export function renderConsent(
  req: Request,
  input: { clientName: string; redirectHost: string; userName: string; preselect: "read" | "write"; allowWrite: boolean; fields: Record<string, string> },
): string {
  const lang = languageOf(req);
  const radio = (value: "read" | "write", label: MessageKey, hint: MessageKey) =>
    `<label class="choice"><input type="radio" name="grant_scope" value="${value}"${input.preselect === value ? " checked" : ""}><div><strong>${text(lang, label)}</strong><span>${text(lang, hint)}</span></div></label>`;
  return layout(lang, text(lang, "consentTitle"), `
<h1>${text(lang, "consentTitle")}</h1>
<p>${text(lang, "consentIntro", { client: input.clientName })}</p>
<form method="post" action="/oauth/authorize/decision">
${Object.entries(input.fields).map(([name, value]) => hidden(name, value)).join("\n")}
${radio("read", "readOnly", "readOnlyHint")}
${input.allowWrite ? radio("write", "readWrite", "readWriteHint") : ""}
<p class="muted">${text(lang, "returnsTo", { host: input.redirectHost })}<br>${text(lang, "signedInAs", { user: input.userName })}</p>
<div class="row"><button type="submit" name="decision" value="deny">${text(lang, "deny")}</button><button class="primary" type="submit" name="decision" value="allow">${text(lang, "allow")}</button></div>
</form>`);
}

export function renderError(req: Request, key: MessageKey, manageUrl?: string | null): string {
  const lang = languageOf(req);
  const link = manageUrl && /^https?:\/\//.test(manageUrl) ? `<p><a href="${escapeHtml(manageUrl)}">${text(lang, "manage")}</a></p>` : "";
  return layout(lang, text(lang, "errorTitle"), `<h1>${text(lang, "errorTitle")}</h1><p>${text(lang, key)}</p>${link}`);
}

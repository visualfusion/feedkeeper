import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError, type Token, type User } from "../api/client.ts";
import { useAuth } from "../auth/AuthContext.tsx";

function ChangePasswordSection() {
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);

    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: t("settings.passwordMismatch") });
      return;
    }

    setSubmitting(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setMessage({ type: "success", text: t("settings.passwordChanged") });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setMessage({ type: "error", text: t("settings.incorrectPassword") });
      } else {
        setMessage({ type: "error", text: t("common.error") });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="card p-5 flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{t("settings.changePasswordTitle")}</h2>
      <form onSubmit={onSubmit} className="flex flex-col gap-3 max-w-sm">
        <input
          type="password"
          required
          placeholder={t("settings.currentPasswordLabel")}
          className="input"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
        <input
          type="password"
          required
          minLength={10}
          placeholder={t("settings.newPasswordLabel")}
          className="input"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
        <input
          type="password"
          required
          minLength={10}
          placeholder={t("settings.confirmPasswordLabel")}
          className="input"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
        {message && (
          <p className={`text-sm ${message.type === "error" ? "text-red-500" : ""}`} style={message.type === "success" ? { color: "var(--c-green3)" } : undefined}>
            {message.text}
          </p>
        )}
        <button type="submit" disabled={submitting} className="btn-primary">
          {t("settings.changePasswordButton")}
        </button>
      </form>
    </section>
  );
}

function TokensSection() {
  const { t } = useTranslation();
  const [tokens, setTokens] = useState<Token[]>([]);
  const [name, setName] = useState("");
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    setTokens(await api.listTokens());
  }

  useEffect(() => {
    load();
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    const { token } = await api.createToken(name);
    setFreshToken(token);
    setName("");
    await load();
  }

  async function onDelete(id: number) {
    await api.deleteToken(id);
    await load();
  }

  async function copy() {
    if (!freshToken) return;
    await navigator.clipboard.writeText(freshToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const mcpUrl = `${window.location.origin}/mcp`;

  return (
    <section className="card p-5 flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{t("settings.tokensTitle")}</h2>
        <p className="text-sm" style={{ color: "var(--c-text-muted)" }}>
          {t("settings.tokensHint")}
        </p>
      </div>

      {freshToken && (
        <div
          className="card p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          style={{ borderColor: "var(--c-green3)" }}
        >
          <div className="min-w-0">
            <p className="text-sm font-medium">{t("settings.tokenCreated")}</p>
            <code className="text-xs break-all">{freshToken}</code>
            <p className="text-xs mt-1" style={{ color: "var(--c-text-muted)" }}>
              {t("settings.tokenCreatedHint")}
            </p>
          </div>
          <button onClick={copy} className="btn-secondary text-sm whitespace-nowrap">
            {copied ? t("settings.copied") : t("settings.copyToken")}
          </button>
        </div>
      )}

      <form onSubmit={onCreate} className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          required
          placeholder={t("settings.tokenNamePlaceholder")}
          className="input sm:flex-1"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="btn-primary whitespace-nowrap">
          {t("settings.createToken")}
        </button>
      </form>

      <ul className="flex flex-col gap-2">
        {tokens.map((tok) => (
          <li key={tok.id} className="flex items-center justify-between text-sm py-2 border-t" style={{ borderColor: "var(--c-border)" }}>
            <span>
              {tok.name} <code style={{ color: "var(--c-text-muted)" }}>{tok.token_prefix}…</code>
            </span>
            <button onClick={() => onDelete(tok.id)} className="btn-secondary text-xs">
              {t("settings.deleteToken")}
            </button>
          </li>
        ))}
      </ul>

      <div className="pt-2 border-t" style={{ borderColor: "var(--c-border)" }}>
        <h3 className="font-medium text-sm mb-1">{t("settings.mcpTitle")}</h3>
        <p className="text-sm mb-2" style={{ color: "var(--c-text-muted)" }}>
          {t("settings.mcpHint")}
        </p>
        <code className="text-xs break-all block card p-2">{mcpUrl}</code>
      </div>
    </section>
  );
}

function UsersSection() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<User[]>([]);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setUsers(await api.listUsers());
  }

  useEffect(() => {
    load();
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.createUser({ email, password, displayName, role });
      setEmail("");
      setDisplayName("");
      setPassword("");
      setRole("user");
      await load();
    } catch {
      setError(t("common.error"));
    }
  }

  return (
    <section className="card p-5 flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{t("settings.usersTitle")}</h2>

      <form onSubmit={onCreate} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input
          type="email"
          required
          placeholder={t("onboarding.emailLabel")}
          className="input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="text"
          required
          placeholder={t("onboarding.displayNameLabel")}
          className="input"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <input
          type="password"
          required
          minLength={10}
          placeholder={t("onboarding.passwordLabel")}
          className="input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <select className="input" value={role} onChange={(e) => setRole(e.target.value as "admin" | "user")}>
          <option value="user">{t("settings.roleUser")}</option>
          <option value="admin">{t("settings.roleAdmin")}</option>
        </select>
        <button type="submit" className="btn-primary sm:col-span-2">
          {t("settings.addUser")}
        </button>
      </form>
      {error && <p className="text-sm text-red-500">{error}</p>}

      <ul className="flex flex-col gap-2">
        {users.map((u) => (
          <li key={u.id} className="flex items-center justify-between text-sm py-2 border-t" style={{ borderColor: "var(--c-border)" }}>
            <span>
              {u.display_name} <span style={{ color: "var(--c-text-muted)" }}>({u.email})</span>
            </span>
            <span className="text-xs uppercase" style={{ color: "var(--c-text-muted)" }}>
              {u.role === "admin" ? t("settings.roleAdmin") : t("settings.roleUser")}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>
      <ChangePasswordSection />
      <TokensSection />
      {user?.role === "admin" && <UsersSection />}
    </div>
  );
}

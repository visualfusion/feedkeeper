import { applyPending, dequeue, enqueue, type ItemAction } from "../utils/offlineQueue.ts";
import { filterOffline, offlineItems, readSnapshot } from "../utils/offlineStore.ts";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public data?: unknown,
  ) {
    super(code);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      credentials: "include",
      ...init,
      headers,
    });
  } catch {
    // fetch only rejects when the server cannot be reached at all.
    throw new ApiError(0, "unreachable");
  }

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, body.error ?? "unknown_error", body);
  }
  return body as T;
}

/** Send a read or bookmark change straight to the server. */
export function sendItemAction(action: ItemAction, itemId: number, value: boolean): Promise<void> {
  if (action === "read") return request<void>(`/items/${itemId}/${value ? "read" : "unread"}`, { method: "POST" });
  return request<void>(`/items/${itemId}/bookmark`, { method: value ? "POST" : "DELETE" });
}

/** Without a connection the change is kept and sent later, so the app keeps working. */
async function changeItem(action: ItemAction, itemId: number, value: boolean): Promise<void> {
  try {
    await sendItemAction(action, itemId, value);
    dequeue(action, itemId);
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 0)) throw error;
    enqueue(action, itemId, value);
  }
}

export function isUnreachable(error: unknown): boolean {
  return error instanceof ApiError && error.status === 0;
}

/** Failures that a later attempt can fix: no connection, a busy or restarting server, an expired session. */
export function isTransient(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 0 || error.status === 401 || error.status === 408 || error.status === 429 || error.status >= 500);
}

export interface PublicConfig {
  showGithubLink: boolean;
  githubUrl: string;
}

export interface DiscoveredFeed {
  url: string;
  title: string | null;
  type: string;
}

export interface RetentionSettings {
  retentionReadDays: number;
  retentionMaxDays: number;
  retentionMaxItemsPerFeed: number;
  autoCleanupEnabled: boolean;
}

export interface DatabaseStats {
  totalItems: number;
  readItems: number;
  feedsCount: number;
  oldestItemDate: string | null;
  databaseSizeBytes: number;
}

export interface CleanupResult {
  deletedReadItems: number;
  deletedOldItems: number;
  deletedPerFeedExcess: number;
  totalDeleted: number;
  sizeBefore: number;
  sizeAfter: number;
}

export interface AccountCapabilities {
  type: "selfhosted" | string;
  features: {
    mcp: boolean;
    sync: boolean;
    notes: boolean;
    editions: boolean;
    fulltext: boolean;
    [key: string]: boolean;
  };
  manageUrl: string | null;
}

export interface User {
  id: number;
  email: string;
  display_name: string;
  role: "admin" | "user";
  created_at: string;
  avatar_updated_at: string | null;
  /** When the introduction to the app was closed; null while it is still to be shown. */
  intro_dismissed_at: string | null;
  capabilities?: AccountCapabilities;
}

/** Versioned photo URL so a new upload bypasses the long-lived browser cache. */
export function avatarUrl(user: Pick<User, "avatar_updated_at">): string | null {
  return user.avatar_updated_at ? `/api/auth/me/avatar?v=${encodeURIComponent(user.avatar_updated_at)}` : null;
}

export interface Feed {
  id: number;
  url: string;
  title: string | null;
  site_url: string | null;
  poll_interval_minutes: number;
  last_polled_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  consecutive_errors: number;
  subscription_id: number;
  label: string | null;
  folder_id: number | null;
  folder_name: string | null;
  unread_count: number;
  position: number;
  full_text_mode: "auto" | "never";
  full_text_blocked_at: string | null;
  icon_url: string | null;
  /** 1 when new articles of this feed trigger a notification. */
  notify: number;
  /** 1 when this feed's unread articles count towards the number on the app icon. */
  badge: number;
}

export interface Folder {
  id: number;
  user_id: number;
  name: string;
  created_at: string;
  feed_count: number;
  unread_count: number;
}

export interface Item {
  id: number;
  feed_id: number;
  feed_title: string | null;
  feed_site_url?: string | null;
  feed_url?: string;
  feed_full_text_mode?: "auto" | "never";
  feed_icon_url?: string | null;
  title: string | null;
  link: string | null;
  content_snippet: string | null;
  content_html?: string | null;
  full_content_html?: string | null;
  image_url?: string | null;
  published_at: string | null;
  read: boolean;
  bookmarked: boolean;
}

export interface MutedKeyword {
  id: number;
  user_id: number;
  keyword: string;
  created_at: string;
}

export interface Device {
  id: number;
  name: string;
  platform: string | null;
  appVersion: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  current: boolean;
}

export interface PairingCode {
  code: string;
  expiresAt: string;
  /** What the QR code contains: the server address and the one-time code. */
  pairingUrl: string;
}

export interface Token {
  id: number;
  name: string;
  scope: "read" | "write";
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
}

export interface OAuthGrant {
  id: number;
  client_name: string;
  scope: "read" | "write";
  created_at: string;
  last_used_at: string | null;
}

export interface OpmlImportResult {
  imported: number;
  skipped: number;
  failed: number;
  errors: Array<{ url: string; reason: string }>;
}

export const api = {
  getConfig: () => request<PublicConfig>("/config"),
  onboardingStatus: () => request<{ needsOnboarding: boolean }>("/onboarding/status"),
  onboard: (data: { email: string; password: string; displayName: string }) =>
    request<User>("/onboarding", { method: "POST", body: JSON.stringify(data) }),

  login: (email: string, password: string) =>
    request<User>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>("/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }),
  me: () => request<User>("/auth/me"),
  updateProfile: (displayName: string) =>
    request<User>("/auth/me", { method: "PATCH", body: JSON.stringify({ displayName }) }),
  uploadAvatar: (image: Blob) =>
    request<User>("/auth/me/avatar", { method: "PUT", headers: { "Content-Type": image.type }, body: image }),
  deleteAvatar: () => request<User>("/auth/me/avatar", { method: "DELETE" }),
  dismissIntro: () => request<User>("/auth/me/intro", { method: "POST" }),
  listUsers: () => request<User[]>("/auth/users"),
  createUser: (data: { email: string; password: string; displayName: string; role: "admin" | "user" }) =>
    request<User>("/auth/users", { method: "POST", body: JSON.stringify(data) }),

  listFeeds: () => request<Feed[]>("/feeds"),
  discoverFeeds: (url: string) => request<{ feeds: DiscoveredFeed[] }>("/feeds/discover", { method: "POST", body: JSON.stringify({ url }) }),
  subscribeFeed: (url: string, label: string | null, folderId?: number | null) =>
    request<Feed>("/feeds", { method: "POST", body: JSON.stringify({ url, label, folderId }) }),
  unsubscribeFeed: (feedId: number) => request<void>(`/feeds/${feedId}`, { method: "DELETE" }),
  updateFeed: (feedId: number, data: { label?: string | null; folderId?: number | null; pollIntervalMinutes?: number; fullTextMode?: "auto" | "never"; notify?: boolean; badge?: boolean }) =>
    request<Feed>(`/feeds/${feedId}`, { method: "PATCH", body: JSON.stringify(data) }),
  pushKey: () => request<{ publicKey: string }>("/push/key"),
  savePushDevice: (device: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
    request<void>("/push/devices", { method: "POST", body: JSON.stringify(device) }),
  checkPushDevice: (endpoint: string) =>
    request<{ registered: boolean }>("/push/devices/check", { method: "POST", body: JSON.stringify({ endpoint }) }),
  removePushDevice: (endpoint: string) =>
    request<void>("/push/devices/remove", { method: "POST", body: JSON.stringify({ endpoint }) }),
  sendTestPush: (language: string) => request<{ delivered: number }>("/push/test", { method: "POST", body: JSON.stringify({ language }) }),
  reorderFeeds: (feedIds: number[]) =>
    request<{ ok: boolean }>("/feeds/reorder", { method: "PUT", body: JSON.stringify({ feedIds }) }),
  exportOpmlUrl: () => "/api/feeds/opml",
  importOpml: (opmlContent: string) =>
    request<OpmlImportResult>("/feeds/opml", {
      method: "POST",
      headers: { "Content-Type": "application/xml" },
      body: opmlContent,
    }),
  refreshFeed: (feedId: number) =>
    request<{ feed: Feed; newItems: number; error: string | null }>(`/feeds/${feedId}/refresh`, { method: "POST" }),
  refreshAllFeeds: () =>
    request<{ refreshed: number; newItems: number; errors: number }>("/feeds/refresh-all", { method: "POST" }),

  listFolders: () => request<{ folders: Folder[] }>("/folders"),
  createFolder: (name: string) =>
    request<Folder>("/folders", { method: "POST", body: JSON.stringify({ name }) }),
  updateFolder: (id: number, name: string) =>
    request<Folder>(`/folders/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  deleteFolder: (id: number) => request<{ success: boolean }>(`/folders/${id}`, { method: "DELETE" }),
  markFolderRead: (id: number) => request<{ read: number }>(`/folders/${id}/read`, { method: "POST" }),

  listItems: async (
    params: {
      feedId?: number;
      folderId?: number;
      unreadOnly?: boolean;
      bookmarkedOnly?: boolean;
      includeMuted?: boolean;
      /** Rewrite images so the web app can keep them for offline reading. */
      offline?: boolean;
      search?: string;
      limit?: number;
      offset?: number;
    } = {},
  ) => {
    const query = new URLSearchParams();
    if (params.feedId) query.set("feedId", String(params.feedId));
    if (params.folderId) query.set("folderId", String(params.folderId));
    if (params.unreadOnly) query.set("unreadOnly", "true");
    if (params.bookmarkedOnly) query.set("bookmarkedOnly", "true");
    if (params.includeMuted) query.set("includeMuted", "true");
    if (params.offline) query.set("offline", "true");
    if (params.search) query.set("search", params.search);
    if (params.limit) query.set("limit", String(params.limit));
    if (params.offset) query.set("offset", String(params.offset));
    const qs = query.toString();
    // Offline, read from the copy kept on this device, including changes not sent yet.
    const fromDevice = async () => {
      const snapshot = await readSnapshot();
      return snapshot ? filterOffline(applyPending(offlineItems(snapshot)), snapshot.feedFolders, params) : null;
    };
    if (!navigator.onLine && !params.offline) {
      const items = await fromDevice();
      if (items) return items;
    }
    try {
      return applyPending(await request<Item[]>(`/items${qs ? `?${qs}` : ""}`));
    } catch (error) {
      if (isUnreachable(error)) {
        const items = await fromDevice();
        if (items) return items;
      }
      throw error;
    }
  },
  markRead: (itemId: number) => changeItem("read", itemId, true),
  markUnread: (itemId: number) => changeItem("read", itemId, false),
  bookmarkItem: (itemId: number) => changeItem("bookmark", itemId, true),
  unbookmarkItem: (itemId: number) => changeItem("bookmark", itemId, false),
  extractContent: (itemId: number) =>
    request<{
      id: number;
      full_content_html: string;
      title?: string;
      byline?: string;
      cached: boolean;
    }>(`/items/${itemId}/extract-content`, { method: "POST" }),
  markAllRead: (options?: number | { feedId?: number; folderId?: number }) => {
    const feedId = typeof options === "number" ? options : options?.feedId;
    const folderId = typeof options === "object" ? options?.folderId : undefined;
    return request<{ marked: number }>("/items/mark-all-read", {
      method: "POST",
      body: JSON.stringify({ feedId, folderId }),
    });
  },

  listMutedKeywords: () => request<{ keywords: MutedKeyword[] }>("/filters/muted"),
  addMutedKeyword: (keyword: string) =>
    request<MutedKeyword>("/filters/muted", { method: "POST", body: JSON.stringify({ keyword }) }),
  deleteMutedKeyword: (id: number) => request<void>(`/filters/muted/${id}`, { method: "DELETE" }),

  listDevices: () => request<Device[]>("/v1/devices"),
  createPairingCode: () => request<PairingCode>("/v1/pairing-codes", { method: "POST" }),
  revokeDevice: (id: number) => request<void>(`/v1/devices/${id}`, { method: "DELETE" }),
  listTokens: () => request<Token[]>("/tokens"),
  createToken: (name: string, scope: "read" | "write") =>
    request<{ id: number; token: string }>("/tokens", { method: "POST", body: JSON.stringify({ name, scope }) }),
  deleteToken: (id: number) => request<void>(`/tokens/${id}`, { method: "DELETE" }),
  listOAuthGrants: () => request<OAuthGrant[]>("/oauth-grants"),
  deleteOAuthGrant: (id: number) => request<void>(`/oauth-grants/${id}`, { method: "DELETE" }),

  getRetention: () => request<{ settings: RetentionSettings; stats: DatabaseStats }>("/system/retention"),
  updateRetention: (data: Partial<RetentionSettings>) =>
    request<{ settings: RetentionSettings; stats: DatabaseStats }>("/system/retention", {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  runCleanup: () =>
    request<{ result: CleanupResult; stats: DatabaseStats }>("/system/cleanup", { method: "POST" }),
};

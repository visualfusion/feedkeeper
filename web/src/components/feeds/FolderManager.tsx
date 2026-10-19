import { usePlanLimits } from "../../utils/planLimits.ts";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, type Folder } from "../../api/client.ts";
import { toast } from "../../utils/toast.ts";
import { CloseIcon, TrashIcon } from "./icons.tsx";

function FolderNameInput({ folder, onRenamed }: { folder: Folder; onRenamed: () => Promise<void> }) {
  const { t } = useTranslation();
  const [name, setName] = useState(folder.name);

  async function commit() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === folder.name) {
      setName(folder.name);
      return;
    }
    try {
      await api.updateFolder(folder.id, trimmed);
      toast.success(t("feeds.folderRenamed", { name: trimmed }));
      await onRenamed();
    } catch {
      setName(folder.name);
      toast.error(t("common.error"));
    }
  }

  return (
    <input
      className="input h-9 min-h-0 flex-1 border-transparent bg-transparent px-2 text-sm shadow-none hover:border-[var(--c-border)] focus:border-[var(--c-border)]"
      value={name}
      onChange={(e) => setName(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setName(folder.name);
      }}
    />
  );
}

/** Create, rename (click the name) and delete categories. */
export function FolderManager({ folders, onClose, onChanged }: { folders: Folder[]; onClose: () => void; onChanged: () => Promise<void> }) {
  const { t } = useTranslation();
  const { syncAllowed } = usePlanLimits();
  const [newName, setNewName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (!newName.trim()) return;
    setSubmitting(true);
    try {
      await api.createFolder(newName.trim());
      toast.success(t("feeds.folderCreated", { name: newName.trim() }));
      setNewName("");
      await onChanged();
    } catch {
      toast.error(t("common.error"));
    } finally {
      setSubmitting(false);
    }
  }

  async function onDelete(folder: Folder) {
    if (!confirm(t("feeds.deleteFolderConfirm", { name: folder.name }))) return;
    try {
      await api.deleteFolder(folder.id);
      toast.success(t("feeds.folderDeleted", { name: folder.name }));
      await onChanged();
    } catch {
      toast.error(t("common.error"));
    }
  }

  return (
    <section className="card animate-fade-in flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">{t("feeds.manageFolders")}</h2>
          <p className="mt-0.5 text-xs text-[var(--c-text-muted)]">{t("feeds.renameFolderHint")}</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-1 text-[var(--c-text-muted)] hover:bg-[var(--c-surface-hover)] hover:text-[var(--c-text)] cursor-pointer" aria-label={t("common.close")}>
          <CloseIcon />
        </button>
      </div>

      {folders.length > 0 && (
        <ul className="divide-y divide-[var(--c-border)] rounded-xl border border-[var(--c-border)]">
          {folders.map((folder) => (
            <li key={folder.id} className="flex items-center gap-2 px-2 py-1.5">
              <FolderNameInput key={folder.name} folder={folder} onRenamed={onChanged} />
              <span className="shrink-0 text-xs tabular-nums text-[var(--c-text-muted)]">{t("feeds.feedCount", { count: folder.feed_count ?? 0 })}</span>
              <button type="button" onClick={() => onDelete(folder)} className="rounded-lg p-2 text-[var(--c-text-muted)] hover:bg-[var(--c-danger-bg)] hover:text-[var(--c-danger)] cursor-pointer" aria-label={t("common.delete")} title={t("common.delete")}>
                <TrashIcon />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={onCreate} className="flex gap-2">
        <input type="text" disabled={!syncAllowed} placeholder={t("feeds.newFolderPlaceholder")} className="input flex-1" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button type="submit" disabled={submitting || !syncAllowed || !newName.trim()} title={syncAllowed ? undefined : t("plan.unavailable")} className="btn-primary whitespace-nowrap">{t("feeds.addFolder")}</button>
      </form>
    </section>
  );
}

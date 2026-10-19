export interface Toast {
  id: number;
  type: "success" | "error" | "info";
  message: string;
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function subscribeToasts(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getToasts(): Toast[] {
  return toasts;
}

export function dismissToast(id: number) {
  toasts = toasts.filter((toast) => toast.id !== id);
  emit();
}

function show(type: Toast["type"], message: string) {
  const id = nextId++;
  // Keep at most three on screen; the oldest goes first.
  toasts = [...toasts.slice(-2), { id, type, message }];
  emit();
  window.setTimeout(() => dismissToast(id), type === "error" ? 7000 : 4000);
}

/** Short app-wide feedback for completed actions. */
export const toast = {
  success: (message: string) => show("success", message),
  error: (message: string) => show("error", message),
  info: (message: string) => show("info", message),
};

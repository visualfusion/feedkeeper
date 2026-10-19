import type { ReactNode } from "react";

function Icon({ children, className = "h-4 w-4" }: { children: ReactNode; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const RefreshIcon = ({ className }: { className?: string }) => (
  <Icon className={className}><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></Icon>
);
export const CheckAllIcon = () => <Icon><path d="M2 12l4 4 6-7M10 16l2 0 8-9" /></Icon>;
export const EditIcon = () => <Icon><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></Icon>;
export const TrashIcon = () => <Icon><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></Icon>;
export const PlusIcon = ({ className }: { className?: string }) => <Icon className={className}><path d="M12 5v14M5 12h14" /></Icon>;
export const UploadIcon = () => <Icon><path d="M12 15V3M7 8l5-5 5 5" /><path d="M5 21h14" /></Icon>;
export const DownloadIcon = () => <Icon><path d="M12 3v12M7 10l5 5 5-5" /><path d="M5 21h14" /></Icon>;
export const FolderIcon = () => <Icon><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></Icon>;
export const SearchIcon = () => <Icon className="h-4 w-4"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Icon>;
export const GripIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    {[6, 12, 18].flatMap((y) => [9, 15].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.5" />))}
  </svg>
);
export const CloseIcon = () => <Icon className="h-5 w-5"><path d="M18 6 6 18M6 6l12 12" /></Icon>;
export const AlertIcon = () => <Icon className="h-3.5 w-3.5 shrink-0"><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></Icon>;
export const BellIcon = ({ className = "h-3.5 w-3.5" }: { className?: string }) => (
  <Icon className={className}>
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </Icon>
);

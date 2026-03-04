import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  children?: ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action, children }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 animate-[fade-in_0.2s_ease-out]">
      <Icon size={18} className="text-fg-muted mb-3" />
      <p className="text-[15px] font-medium text-fg-secondary tracking-[-0.02em]">
        {title}
      </p>
      {description && (
        <p className="text-[14px] text-fg-tertiary tracking-[-0.01em] mt-1">
          {description}
        </p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 text-[14px] text-fg-secondary hover:text-fg-primary tracking-[-0.01em] transition-colors duration-100"
        >
          {action.label} &rarr;
        </button>
      )}
      {children}
    </div>
  );
}

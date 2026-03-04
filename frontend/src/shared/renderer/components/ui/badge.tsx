import type { HTMLAttributes, ReactNode } from "react";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "outline" | "success" | "warning" | "error";
  children?: ReactNode;
}

const variantStyles: Record<string, string> = {
  default: "bg-bg-tertiary text-fg-secondary",
  outline: "text-fg-tertiary border border-border",
  success: "text-success bg-success/5 border border-success/15",
  warning: "text-warning bg-warning/5 border border-warning/15",
  error: "text-error bg-error/5 border border-error/15",
};

export function Badge({ variant = "default", className = "", children, ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-px rounded-[3px] text-[12px] font-mono tracking-[-0.02em] leading-none whitespace-nowrap ${variantStyles[variant]} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
}

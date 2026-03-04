import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "outline" | "danger";
  size?: "sm" | "md" | "lg";
}

const variantStyles: Record<string, string> = {
  primary:
    "bg-fg-primary text-bg-primary hover:bg-fg-secondary",
  secondary:
    "bg-bg-elevated text-fg-primary border border-border-strong hover:border-fg-muted/25",
  ghost:
    "bg-transparent text-fg-secondary hover:text-fg-primary",
  outline:
    "bg-transparent text-fg-primary border border-border hover:border-border-strong",
  danger:
    "bg-transparent text-error hover:bg-error/10 border border-transparent hover:border-error/20",
};

const sizeStyles: Record<string, string> = {
  sm: "h-8 px-3 text-[14px]",
  md: "h-9 px-4 text-[14px]",
  lg: "h-10 px-5 text-[15px]",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] font-medium tracking-[-0.01em] transition-all duration-100 ease-out focus:outline-none focus:ring-1 focus:ring-focus-ring disabled:opacity-30 disabled:pointer-events-none active:scale-[0.98] ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

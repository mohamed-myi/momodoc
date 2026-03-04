import type { InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export function Input({ className = "", ...props }: InputProps) {
  return (
    <input
      className={`w-full h-10 px-3 bg-bg-input text-fg-primary border border-border rounded-[var(--radius-sm)] text-[14px] shadow-[inset_0_1px_2px_rgba(0,0,0,0.2)] placeholder:text-fg-muted transition-colors duration-100 ease-out focus:outline-none focus:ring-1 focus:ring-focus-ring focus:border-border-strong ${className}`}
      {...props}
    />
  );
}

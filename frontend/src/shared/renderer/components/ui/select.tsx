import type { SelectHTMLAttributes } from "react";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {}

export function Select({ className = "", children, ...props }: SelectProps) {
  return (
    <select
      className={`h-8 px-2.5 bg-bg-input text-fg-primary border border-border rounded-[var(--radius-sm)] text-[14px] shadow-[inset_0_1px_2px_rgba(0,0,0,0.2)] transition-colors duration-100 ease-out focus:outline-none focus:ring-1 focus:ring-focus-ring focus:border-border-strong appearance-none pr-7 bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2371717a%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[position:right_6px_center] bg-no-repeat ${className}`}
      {...props}
    >
      {children}
    </select>
  );
}

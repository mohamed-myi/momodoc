import type { HTMLAttributes } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hoverable?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
  as?: "div" | "button";
}

const paddingStyles: Record<string, string> = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-5",
};

export function Card({
  hoverable = false,
  padding = "md",
  as = "div",
  className = "",
  children,
  ...props
}: CardProps) {
  const Component = as;
  return (
    <Component
      className={`bg-bg-elevated border border-border-strong rounded-[var(--radius-default)] ${paddingStyles[padding]} ${
        hoverable
          ? "transition-colors duration-100 ease-out hover:border-fg-muted/25 cursor-pointer"
          : ""
      } ${as === "button" ? "text-left w-full" : ""} ${className}`}
      {...(props as Record<string, unknown>)}
    >
      {children}
    </Component>
  );
}

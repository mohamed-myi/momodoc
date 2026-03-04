interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeStyles: Record<string, string> = {
  sm: "w-4 h-4 border-[1.5px]",
  md: "w-5 h-5 border-2",
  lg: "w-6 h-6 border-2",
};

export function Spinner({ size = "md", className = "" }: SpinnerProps) {
  return (
    <div
      role="status"
      className={`border-fg-muted border-t-fg-primary rounded-full animate-[spin_0.8s_linear_infinite] ${sizeStyles[size]} ${className}`}
    />
  );
}

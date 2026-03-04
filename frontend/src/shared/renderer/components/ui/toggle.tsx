
interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  className?: string;
}

export function Toggle({ checked, onChange, label, className = "" }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-150 ease-out focus:outline-none focus:ring-1 focus:ring-focus-ring ${
        checked ? "bg-fg-primary" : "bg-bg-tertiary"
      } ${className}`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-bg-primary transition-transform duration-150 ease-out ${
          checked ? "translate-x-[18px]" : "translate-x-[3px]"
        }`}
      />
    </button>
  );
}

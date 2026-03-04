import { useRef, useImperativeHandle, forwardRef, type TextareaHTMLAttributes } from "react";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  autoResize?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ autoResize = false, className = "", ...rest }, forwardedRef) {
    const innerRef = useRef<HTMLTextAreaElement>(null);

    useImperativeHandle(forwardedRef, () => innerRef.current!);

    return (
      <textarea
        {...rest}
        ref={innerRef}
        className={`w-full min-h-[44px] max-h-[200px] px-3 py-2.5 bg-bg-input text-fg-primary border border-border rounded-[var(--radius-sm)] text-[14px] shadow-[inset_0_1px_2px_rgba(0,0,0,0.2)] placeholder:text-fg-muted resize-none transition-colors duration-100 ease-out focus:outline-none focus:ring-1 focus:ring-focus-ring focus:border-border-strong ${className}`}
        onInput={(e) => {
          if (autoResize && innerRef.current) {
            innerRef.current.style.height = "auto";
            innerRef.current.style.height = `${Math.min(innerRef.current.scrollHeight, 200)}px`;
          }
          rest.onInput?.(e);
        }}
      />
    );
  }
);

import { Button } from "./ui/button";

interface ErrorPageProps {
  message?: string;
  onRetry?: () => void;
}

export function ErrorPage({
  message = "an unexpected error occurred",
  onRetry,
}: ErrorPageProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-3 animate-[fade-in_0.2s_ease-out]">
      <p className="text-[15px] font-medium tracking-[-0.02em]">
        something went wrong
      </p>
      <p className="text-[14px] text-fg-tertiary tracking-[-0.01em]">
        {message}
      </p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry} className="mt-2">
          retry
        </Button>
      )}
    </div>
  );
}

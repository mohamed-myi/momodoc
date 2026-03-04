import { Spinner } from "./ui/spinner";

export function LoadingPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen animate-[fade-in_0.2s_ease-out]">
      <Spinner size="md" />
    </div>
  );
}

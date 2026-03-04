import { useCallback, useRef, useState } from "react";

interface ResizeHandleProps {
  onResize: (delta: number) => void;
  className?: string;
}

export function ResizeHandle({ onResize, className = "" }: ResizeHandleProps) {
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startX.current = e.clientX;
      setDragging(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const handleMouseMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX.current;
        startX.current = ev.clientX;
        onResize(delta);
      };

      const handleMouseUp = () => {
        setDragging(false);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [onResize]
  );

  return (
    <div
      onMouseDown={handleMouseDown}
      className={`group relative w-1 shrink-0 cursor-col-resize ${className}`}
    >
      <div
        className={`absolute inset-y-0 left-1/2 -translate-x-1/2 w-[2px] transition-colors duration-100 ${
          dragging
            ? "bg-fg-muted/50"
            : "bg-transparent group-hover:bg-fg-muted/30"
        }`}
      />
    </div>
  );
}

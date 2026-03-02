import { useEffect, useState } from "react";

const CursorGlow = () => {
  const [point, setPoint] = useState({ x: -200, y: -200 });

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      setPoint({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  return (
    <div
      className="pointer-events-none fixed z-40 h-40 w-40 rounded-full bg-cyan-300/20 blur-3xl transition-transform duration-150"
      style={{ transform: `translate3d(${point.x - 80}px, ${point.y - 80}px, 0)` }}
    />
  );
};

export default CursorGlow;

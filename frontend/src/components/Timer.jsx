import { useEffect, useRef, useState } from "react";
import { Timer as TimerIcon } from "lucide-react";

export default function Timer({ totalSeconds, onExpire }) {
  const [remaining, setRemaining] = useState(totalSeconds);
  const expiredRef = useRef(false);

  useEffect(() => {
    if (remaining <= 0) {
      if (!expiredRef.current) {
        expiredRef.current = true;
        onExpire?.();
      }
      return;
    }
    const id = setInterval(() => setRemaining((r) => r - 1), 1000);
    return () => clearInterval(id);
  }, [remaining, onExpire]);

  const pct = (remaining / totalSeconds) * 100;
  const critical = pct <= 10;
  const warn = pct <= 25 && !critical;

  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;
  const pad = (n) => String(n).padStart(2, "0");

  const color = critical ? "text-coral" : warn ? "text-amber" : "text-electric-light";
  const glow = critical ? "shadow-[0_0_20px_rgba(255,107,129,0.35)]" : warn ? "shadow-[0_0_20px_rgba(251,191,109,0.3)]" : "shadow-glow-cyan";

  return (
    <div className={`glass-card flex items-center gap-2.5 px-4 py-2 ${glow} ${critical ? "animate-pulseGlow" : ""}`}>
      <TimerIcon className={`h-4 w-4 ${color}`} strokeWidth={2.25} />
      <span className={`font-mono text-lg font-semibold font-tabular ${color}`}>
        {h > 0 ? `${pad(h)}:` : ""}
        {pad(m)}:{pad(s)}
      </span>
    </div>
  );
}

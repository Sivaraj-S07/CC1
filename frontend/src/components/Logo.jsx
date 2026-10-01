export default function Logo({ size = "md", showWordmark = true }) {
  const dims = size === "sm" ? "h-8 w-8" : size === "lg" ? "h-12 w-12" : "h-9 w-9";
  const textSize = size === "sm" ? "text-sm" : size === "lg" ? "text-xl" : "text-base";

  return (
    <div className="flex items-center gap-2.5 select-none">
      <div className={`relative ${dims} shrink-0 overflow-hidden rounded-full`}>
        <img
          src="/logo.png"
          alt="Coding Club logo"
          className="h-full w-full object-contain"
          draggable="false"
        />
        <div className="absolute inset-0 blur-md opacity-50 -z-10" style={{ background: "radial-gradient(circle, #3E8BFF, transparent 70%)" }} />
      </div>
      {showWordmark && (
        <div className="leading-tight">
          <p className={`font-display font-semibold tracking-tight ${textSize} text-ink-100`}>
            Coding<span className="text-electric-light">Club</span>
          </p>
          <p className="text-[10px] uppercase tracking-[0.2em] text-ink-500 -mt-0.5">Learn · Code · Build</p>
        </div>
      )}
    </div>
  );
}

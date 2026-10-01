const variants = {
  primary:
    "bg-gradient-to-b from-electric-light to-electric text-void font-semibold shadow-glow hover:brightness-110 hover:-translate-y-0.5 active:translate-y-0",
  secondary:
    "glass text-ink-100 hover:border-electric/40 hover:-translate-y-0.5 active:translate-y-0",
  ghost:
    "text-ink-300 hover:text-ink-100 hover:bg-white/5",
  danger:
    "bg-gradient-to-b from-coral to-[#E14C63] text-void font-semibold shadow-[0_0_20px_rgba(255,107,129,0.35)] hover:brightness-110 hover:-translate-y-0.5",
  success:
    "bg-gradient-to-b from-mint to-[#1FBE95] text-void font-semibold shadow-[0_0_20px_rgba(52,228,176,0.3)] hover:brightness-110 hover:-translate-y-0.5",
};

const sizes = {
  sm: "text-xs px-3 py-1.5 rounded-lg gap-1.5",
  md: "text-sm px-4 py-2.5 rounded-xl gap-2",
  lg: "text-base px-6 py-3.5 rounded-2xl gap-2.5",
};

export default function Button({
  children,
  variant = "primary",
  size = "md",
  icon: Icon,
  className = "",
  ...props
}) {
  return (
    <button
      className={`inline-flex items-center justify-center font-medium transition-all duration-200 disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {Icon && <Icon className="h-4 w-4" strokeWidth={2.25} />}
      {children}
    </button>
  );
}

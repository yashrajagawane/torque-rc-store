export const BrandLogo = () => (
  <span className="inline-flex items-center gap-2 leading-none" aria-label="Fly RC Hobbies">
    <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[3px] rounded-tr-xl rounded-bl-xl border-2 border-orange-300/40 bg-gradient-to-br from-orange-400 via-accent to-orange-700 text-black skew-x-[-10deg] shadow-[0_0_18px_rgba(255,85,0,0.3)] transition-transform group-hover:scale-105">
      <span className="absolute -right-1 top-1 h-0.5 w-5 rotate-[-28deg] bg-black/45" />
      <span className="absolute -right-2 top-4 h-0.5 w-6 rotate-[-28deg] bg-black/35" />
      <svg viewBox="0 0 32 32" aria-hidden="true" className="h-6 w-6 skew-x-[10deg] -rotate-6">
        <path d="M3 20h3l3-6 6-3h7l5 5 2 1v5h-3a3 3 0 0 1-6 0h-7a3 3 0 0 1-6 0H3z" fill="currentColor" />
        <path d="m11 14 4-2h6l3 3h-9z" fill="#ff5708" />
        <circle cx="9" cy="22" r="2.7" fill="#ff5708" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="23" cy="22" r="2.7" fill="#ff5708" stroke="currentColor" strokeWidth="1.5" />
        <path d="M5 17H1M6 14H3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M27 13 30 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </span>
    <span className="flex flex-col uppercase italic tracking-tight">
      <span className="text-sm font-black text-white md:text-base">Fly RC</span>
      <span className="text-[10px] font-black tracking-[0.2em] text-accent md:text-[11px]">Hobbies</span>
    </span>
  </span>
);

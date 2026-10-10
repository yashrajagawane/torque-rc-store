export const BrandLogo = () => (
  <span className="inline-flex items-center gap-2 leading-none" aria-label="Fly RC Hobbies">
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-accent/50 bg-accent text-black skew-x-[-10deg] shadow-[0_0_18px_rgba(255,85,0,0.2)] transition-transform group-hover:scale-105">
      <svg viewBox="0 0 32 32" aria-hidden="true" className="h-6 w-6 skew-x-[10deg] -rotate-12">
        <path d="m6 21 4-8 9-3 7 4-2 5-8 4-7 1z" fill="currentColor" />
        <path d="m12 13 3-5 4 1-1 6M18 19l5 4M9 21l-2 5M22 14l5-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="11" cy="23" r="2.2" fill="#ff5708" />
        <circle cx="22" cy="19" r="2.2" fill="#ff5708" />
        <path d="M6 27 2 30M25 7l4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity=".65" />
      </svg>
    </span>
    <span className="flex flex-col uppercase italic tracking-tight">
      <span className="text-sm font-black text-white md:text-base">Fly RC</span>
      <span className="text-[10px] font-black tracking-[0.2em] text-accent md:text-[11px]">Hobbies</span>
    </span>
  </span>
);

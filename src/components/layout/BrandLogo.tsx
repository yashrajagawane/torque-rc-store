export const BrandLogo = () => (
  <span className="inline-flex items-center gap-2 leading-none" aria-label="Fly RC Hobbies">
    <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[3px] rounded-tr-xl rounded-bl-xl border-2 border-orange-300/40 bg-gradient-to-br from-orange-400 via-accent to-orange-700 text-black skew-x-[-10deg] shadow-[0_0_18px_rgba(255,85,0,0.3)] transition-transform group-hover:scale-105">
      <span className="absolute -right-1 top-1 h-0.5 w-5 rotate-[-28deg] bg-black/45" />
      <span className="absolute -right-2 top-4 h-0.5 w-6 rotate-[-28deg] bg-black/35" />
      <svg viewBox="0 0 32 32" aria-hidden="true" className="h-6 w-6 skew-x-[10deg] -rotate-6">
        <path d="M3 18h3l2-5h5l3-4h7l4 4h2l2 5v3h-3a3.5 3.5 0 0 1-7 0h-7a3.5 3.5 0 0 1-7 0H3z" fill="currentColor" />
        <path d="M14 13h8l3 3h-12zM11 11l3-4h6l2 4" fill="none" stroke="#ff5708" strokeWidth="1.5" strokeLinejoin="round" />
        <circle cx="9.5" cy="21" r="3.2" fill="#ff5708" stroke="currentColor" strokeWidth="1.7" />
        <circle cx="23.5" cy="21" r="3.2" fill="#ff5708" stroke="currentColor" strokeWidth="1.7" />
        <path d="M6 16H2M27 10l3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </span>
    <span className="flex flex-col uppercase italic tracking-tight">
      <span className="text-sm font-black text-white md:text-base">Fly RC</span>
      <span className="text-[10px] font-black tracking-[0.2em] text-accent md:text-[11px]">Hobbies</span>
    </span>
  </span>
);

import { CarFront } from 'lucide-react';

export const BrandLogo = () => (
  <span className="inline-flex items-center gap-2 leading-none" aria-label="Fly RC Hobbies">
    <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[3px] rounded-tr-xl rounded-bl-xl border-2 border-orange-300/40 bg-gradient-to-br from-orange-400 via-accent to-orange-700 text-black skew-x-[-10deg] shadow-[0_0_18px_rgba(255,85,0,0.3)] transition-transform group-hover:scale-105">
      <span className="absolute -right-1 top-1 h-0.5 w-5 rotate-[-28deg] bg-black/45" />
      <span className="absolute -right-2 top-4 h-0.5 w-6 rotate-[-28deg] bg-black/35" />
      <CarFront aria-hidden="true" size={24} strokeWidth={2.6} className="skew-x-[10deg] -rotate-12" />
    </span>
    <span className="flex flex-col uppercase italic tracking-tight">
      <span className="text-sm font-black text-white md:text-base">Fly RC</span>
      <span className="text-[10px] font-black tracking-[0.2em] text-accent md:text-[11px]">Hobbies</span>
    </span>
  </span>
);

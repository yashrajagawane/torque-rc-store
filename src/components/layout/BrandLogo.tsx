import { CarFront } from 'lucide-react';

export const BrandLogo = () => (
  <span className="inline-flex items-center gap-2 leading-none" aria-label="Fly RC Hobbies">
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-accent/50 bg-accent text-black skew-x-[-10deg] shadow-[0_0_18px_rgba(255,85,0,0.2)] transition-transform group-hover:scale-105">
      <CarFront aria-hidden="true" size={24} strokeWidth={2.6} className="skew-x-[10deg] -rotate-12" />
    </span>
    <span className="flex flex-col uppercase italic tracking-tight">
      <span className="text-sm font-black text-white md:text-base">Fly RC</span>
      <span className="text-[10px] font-black tracking-[0.2em] text-accent md:text-[11px]">Hobbies</span>
    </span>
  </span>
);

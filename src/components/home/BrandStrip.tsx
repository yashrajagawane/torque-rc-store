import { motion } from 'motion/react';

const BRANDS = [
  { name: 'RGT', slug: 'rgt' },
  { name: 'MJX', slug: 'mjx' },
  { name: 'FMS', slug: 'fms' },
  { name: 'JJRC', slug: 'jjrc' },
  { name: 'HB Toys', slug: 'hb-toys' },
  { name: 'MNRC', slug: 'mnrc' },
  { name: 'Rlaarlo', slug: 'rlaarlo' },
  { name: 'Heng Long', slug: 'heng-long' },
  { name: 'Jiabaile', slug: 'jiabaile' },
  { name: 'Suchiyu', slug: 'suchiyu' }
];

export const BrandStrip = () => {
  return (
    <section className="py-16 border-y border-white/5 bg-[#050505]">
      <div className="container px-4 md:px-6">
        <div className="flex flex-col items-center justify-center mb-10 text-center">
          <span className="text-accent font-mono text-[10px] font-bold uppercase tracking-[0.3em] block mb-2 [word-spacing:0.15em]">
            Trusted Partners
          </span>
          <h4 className="text-xs md:text-sm font-bold text-white/50 tracking-wider uppercase [word-spacing:0.2em]">AUTHORIZED DISTRIBUTORS OF TOP RC BRANDS</h4>
        </div>
        
        <div className="flex items-center gap-x-10 gap-y-6 opacity-60 hover:opacity-100 transition-all duration-500 overflow-x-auto no-scrollbar pb-4 md:pb-0 md:flex-wrap md:justify-center">
          {BRANDS.map((brand) => (
            <a 
              key={brand.slug}
              href={`/brands/${brand.slug}`}
              className="text-base md:text-lg font-extrabold italic tracking-wider [word-spacing:0.2em] hover:text-accent transition-colors whitespace-nowrap shrink-0"
            >
              {brand.name}
            </a>
          ))}
        </div>
      </div>
    </section>
  );
};

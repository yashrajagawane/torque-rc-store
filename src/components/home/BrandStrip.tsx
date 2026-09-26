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
          <span className="text-accent font-mono text-[10px] font-bold uppercase tracking-[0.4em] block mb-2">
            Trusted Partners
          </span>
          <h4 className="text-xl text-white/40 italic">AUTHORIZED DISTRIBUTORS OF TOP RC BRANDS</h4>
        </div>
        
        <div className="flex items-center gap-x-12 gap-y-8 opacity-50 grayscale hover:grayscale-0 transition-all duration-500 overflow-x-auto no-scrollbar pb-4 md:pb-0 md:flex-wrap md:justify-center">
          {BRANDS.map((brand) => (
            <a 
              key={brand.slug}
              href={`/brands/${brand.slug}`}
              className="text-2xl md:text-3xl font-black italic tracking-tighter hover:text-accent transition-colors whitespace-nowrap shrink-0"
            >
              {brand.name}
            </a>
          ))}
        </div>
      </div>
    </section>
  );
};

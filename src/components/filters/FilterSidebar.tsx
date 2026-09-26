import { useState } from 'react';
import { Filter, X, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

interface FilterSidebarProps {
  onFilterChange: (filters: any) => void;
  activeFilters: any;
}

const BRANDS = ['RGT', 'MJX', 'FMS', 'JJRC', 'HB Toys', 'MNRC', 'Rlaarlo', 'Heng Long', 'Jiabaile', 'Suchiyu'];
const SCALES = ['1:8', '1:10', '1:12', '1:14', '1:16', '1:18', '1:20'];
const TYPES = ['Crawlers', 'Bashers', 'Drift', 'On-road', 'Construction', 'Marine'];

export const FilterSidebar = ({ onFilterChange, activeFilters }: FilterSidebarProps) => {
  const toggleFilter = (key: string, value: string) => {
    const current = activeFilters[key] || [];
    const updated = current.includes(value)
      ? current.filter((v: string) => v !== value)
      : [...current, value];
    
    onFilterChange({ ...activeFilters, [key]: updated });
  };

  return (
    <aside className="w-full lg:w-64 flex-shrink-0 space-y-10">
      <div>
        <h4 className="text-sm font-black uppercase tracking-[0.2em] mb-6 border-b border-white/5 pb-2">Brands</h4>
        <div className="space-y-3">
          {BRANDS.map((brand) => (
            <label key={brand} className="flex items-center gap-3 cursor-pointer group">
              <input 
                type="checkbox" 
                className="w-4 h-4 rounded-sm bg-[#111] border-white/10 checked:bg-accent focus:ring-0"
                checked={(activeFilters.brand || []).includes(brand.toLowerCase().replace(' ', '-'))}
                onChange={() => toggleFilter('brand', brand.toLowerCase().replace(' ', '-'))}
              />
              <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground group-hover:text-white transition-colors">
                {brand}
              </span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <h4 className="text-sm font-black uppercase tracking-[0.2em] mb-6 border-b border-white/5 pb-2">Scale</h4>
        <div className="flex flex-wrap gap-2">
          {SCALES.map((scale) => (
            <button
              key={scale}
              onClick={() => toggleFilter('scale', scale)}
              className={cn(
                "px-3 py-2 text-[10px] font-black uppercase italic tracking-widest rounded-sm border transition-all",
                (activeFilters.scale || []).includes(scale)
                  ? "bg-accent border-accent text-white"
                  : "border-white/10 text-muted-foreground hover:border-white/30"
              )}
            >
              {scale}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h4 className="text-sm font-black uppercase tracking-[0.2em] mb-6 border-b border-white/5 pb-2">Machine Type</h4>
        <div className="space-y-3">
          {TYPES.map((type) => (
            <label key={type} className="flex items-center gap-3 cursor-pointer group">
              <input 
                type="checkbox" 
                className="w-4 h-4 rounded-sm bg-[#111] border-white/10 checked:bg-accent focus:ring-0"
                checked={(activeFilters.category || []).includes(type.toLowerCase())}
                onChange={() => toggleFilter('category', type.toLowerCase())}
              />
              <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground group-hover:text-white transition-colors">
                {type}
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="pt-6 border-t border-white/5">
        <button 
          onClick={() => onFilterChange({})}
          className="text-[10px] font-black uppercase tracking-[0.2em] text-accent hover:text-white transition-colors"
        >
          Clear All Filters
        </button>
      </div>
    </aside>
  );
};

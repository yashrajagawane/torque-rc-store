import { useState, useEffect, useRef } from 'react';
import { Search, X, ArrowRight, TrendingUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatCurrency } from '../../lib/utils';

interface SearchOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

const POPULAR_SEARCHES = ['Crawlers', 'Bashers', 'Drift', 'RGT', 'MJX', '1:10', '1:12'];

export const SearchOverlay = ({ isOpen, onClose }: SearchOverlayProps) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setQuery('');
      setResults([]);
    }
  }, [isOpen]);

  useEffect(() => {
    const search = async () => {
      if (query.length < 2) {
        setResults([]);
        return;
      }
      setLoading(true);
      try {
        const response = await fetch(`/api/products?search=${encodeURIComponent(query)}`);
        const data = await response.json();
        setResults(data.slice(0, 5));
      } catch (error) {
        console.error('Search error:', error);
      } finally {
        setLoading(false);
      }
    };

    const timer = setTimeout(search, 300);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-background/95 backdrop-blur-md z-[200] p-6 md:p-12"
        >
          <div className="container max-w-4xl mx-auto h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between mb-12">
              <span className="text-xs font-black text-accent uppercase tracking-[0.3em] italic [word-spacing:0.2em]">Search Showroom</span>
              <button onClick={onClose} className="p-3 hover:bg-white/5 rounded-full transition-colors border border-white/5">
                <X size={24} />
              </button>
            </div>

            {/* Input */}
            <div className="relative mb-16">
              <Search className="absolute left-0 top-1/2 -translate-y-1/2 text-white/20" size={32} />
              <input
                ref={inputRef}
                type="text"
                placeholder="SEARCH RC MODELS, BRANDS, PARTS..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full bg-transparent border-none text-xl sm:text-2xl md:text-3xl font-black italic uppercase tracking-normal [word-spacing:0.25em] placeholder:text-white/15 focus:ring-0 pl-12 md:pl-16 pr-4"
              />
              <div className="absolute bottom-0 left-0 w-full h-[1px] bg-white/10 origin-left scale-x-100 transition-transform"></div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-16">
              {/* Popular Searches */}
              <div>
                <div className="flex items-center gap-2 mb-6">
                  <TrendingUp size={16} className="text-accent" />
                  <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground italic">Popular Searches</h3>
                </div>
                <div className="flex flex-wrap gap-3">
                  {POPULAR_SEARCHES.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => setQuery(tag)}
                      className="px-4 py-2 bg-white/5 hover:bg-accent hover:text-white transition-all text-xs font-bold uppercase italic tracking-widest rounded-sm border border-white/5"
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>

              {/* Results */}
              <div>
                <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground italic mb-6">
                  {query.length > 0 ? `Results for "${query}"` : 'Quick Suggestions'}
                </h3>
                
                {loading ? (
                  <div className="space-y-4">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-16 bg-white/5 animate-pulse rounded-sm"></div>
                    ))}
                  </div>
                ) : results.length > 0 ? (
                  <div className="space-y-4">
                    {results.map((product) => (
                      <a
                        key={product.id}
                        href={`/products/${product.slug}`}
                        className="flex items-center gap-4 p-3 hover:bg-white/5 rounded-sm transition-all group"
                      >
                        <div className="w-12 h-12 bg-white flex-shrink-0 p-1 rounded-sm">
                          <img src={product.thumbnail} alt={product.name} className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                        </div>
                        <div className="flex-grow">
                          <h4 className="text-sm font-bold uppercase italic tracking-tight group-hover:text-accent transition-colors">{product.name}</h4>
                          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{product.brandName} • {product.scale}</span>
                        </div>
                        <span className="text-sm font-black italic">{formatCurrency(product.price)}</span>
                      </a>
                    ))}
                    <a href={`/collections/all-rc-models?search=${query}`} className="flex items-center justify-center gap-2 py-3 border border-white/10 text-[10px] font-black uppercase tracking-[0.2em] italic hover:bg-white hover:text-black transition-all">
                      View All Results <ArrowRight size={14} />
                    </a>
                  </div>
                ) : query.length >= 2 ? (
                  <p className="text-sm text-muted-foreground italic">No machines found matching your search.</p>
                ) : (
                  <p className="text-sm text-muted-foreground italic">Enter a keyword to search our garage.</p>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

import { useState, useEffect } from 'react';
import { FilterSidebar } from '../components/filters/FilterSidebar';
import { ProductCard } from '../components/product/ProductCard';
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/utils';

export const CollectionPage = () => {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<any>({});
  const [sort, setSort] = useState('newest');
  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState(false);

  useEffect(() => {
    const fetchProducts = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (sort) params.append('sort', sort);
        Object.entries(filters).forEach(([key, value]: [string, any]) => {
          if (Array.isArray(value) && value.length > 0) {
            params.append(key, value[0]); // Simplified for single selection in API for now
          }
        });

        const response = await fetch(`/api/products?${params.toString()}`);
        const data = await response.json();
        setProducts(data);
      } catch (error) {
        console.error('Failed to fetch products:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchProducts();
  }, [filters, sort]);

  return (
    <div className="pt-32 pb-24">
      <div className="container px-4 md:px-6">
        {/* Page Header */}
        <div className="mb-12">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground mb-4">
            <a href="/" className="hover:text-white transition-colors">Home</a>
            <span>/</span>
            <span className="text-white">All RC Models</span>
          </div>
          <h1 className="text-5xl md:text-7xl mb-4 leading-tight">ALL RC MODELS</h1>
          <p className="text-muted-foreground text-lg max-w-2xl leading-relaxed italic">
            Explore our complete collection of performance RC vehicles built for racing, crawling, drifting and adventure.
          </p>
        </div>

        {/* Toolbar */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-12 py-6 border-y border-white/5">
          <div className="flex items-center gap-4 w-full md:w-auto justify-between md:justify-start">
            <button 
              onClick={() => setIsFilterDrawerOpen(true)}
              className="lg:hidden flex items-center gap-2 text-[10px] font-black uppercase tracking-widest italic border border-white/10 px-4 py-2.5 rounded-sm hover:bg-white hover:text-black transition-all"
            >
              <SlidersHorizontal size={14} /> Filter & Sort
            </button>
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">
              Showing {products.length} Products
            </span>
          </div>

          <div className="flex items-center gap-4 w-full md:w-auto justify-between md:justify-end border-t border-white/5 pt-4 md:border-0 md:pt-0">
            <label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">Sort By:</label>
            <div className="relative group">
              <select 
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className="bg-transparent text-[10px] font-black uppercase tracking-widest italic border-none focus:ring-0 cursor-pointer appearance-none pr-8 py-0"
              >
                <option value="newest" className="bg-card">Newest Arrivals</option>
                <option value="price-low-high" className="bg-card">Price: Low to High</option>
                <option value="price-high-low" className="bg-card">Price: High to Low</option>
                <option value="name-az" className="bg-card">Name: A-Z</option>
              </select>
              <ChevronDown size={12} className="absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
            </div>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-12">
          {/* Sidebar - Desktop */}
          <div className="hidden lg:block">
            <FilterSidebar onFilterChange={setFilters} activeFilters={filters} />
          </div>

          {/* Grid */}
          <div className="flex-grow">
            {loading ? (
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-6">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="aspect-[4/3] bg-white/5 animate-pulse rounded-sm border border-white/5"></div>
                ))}
              </div>
            ) : products.length > 0 ? (
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-10 md:gap-6">
                {products.map((product) => (
                  <ProductCard
                    key={product.id}
                    id={product.id}
                    slug={product.slug}
                    name={product.name}
                    price={product.price}
                    thumbnail={product.thumbnail}
                    brandName={product.brandName}
                    scale={product.scale}
                    terrain={product.terrain}
                    availability={product.availability}
                    featured={product.featured}
                  />
                ))}
              </div>
            ) : (
              <div className="py-24 text-center glass-card p-12">
                <h3 className="text-2xl mb-4 italic">NO MACHINES FOUND</h3>
                <p className="text-muted-foreground mb-8 italic">Try adjusting your filters or search criteria.</p>
                <button 
                  onClick={() => setFilters({})}
                  className="btn-primary"
                >
                  <span className="skew-x-[10deg]">Clear All Filters</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Filter Drawer */}
      <AnimatePresence>
        {isFilterDrawerOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsFilterDrawerOpen(false)}
              className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[100] lg:hidden"
            />
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 left-0 h-full w-[85%] max-w-sm bg-card border-r border-white/5 z-[101] flex flex-col lg:hidden"
            >
              <div className="p-6 border-b border-white/5 flex items-center justify-between">
                <h2 className="text-xl font-black italic tracking-tighter uppercase">Filter & Sort</h2>
                <button onClick={() => setIsFilterDrawerOpen(false)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                  <X size={20} />
                </button>
              </div>
              <div className="flex-grow overflow-y-auto p-6">
                <FilterSidebar onFilterChange={setFilters} activeFilters={filters} />
              </div>
              <div className="p-6 border-t border-white/5">
                <button 
                  onClick={() => setIsFilterDrawerOpen(false)}
                  className="btn-primary w-full py-4"
                >
                  <span className="skew-x-[10deg]">Show {products.length} Results</span>
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

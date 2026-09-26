import { useState, useEffect } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { FilterSidebar } from '../components/filters/FilterSidebar';
import { ProductCard } from '../components/product/ProductCard';
import { ChevronDown, SlidersHorizontal, X, ArrowLeft, Check, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/utils';

interface CollectionPageProps {
  forcedCategory?: string;
}

const CATEGORY_META: Record<string, { title: string; subtitle: string; breadcrumb: string }> = {
  'all-rc-models': {
    title: 'ALL RC MODELS',
    subtitle: 'Explore our complete garage of performance RC crawlers, high-speed bashers, drift cars, boats, and precision scale vehicles.',
    breadcrumb: 'All Models',
  },
  'crawlers': {
    title: 'SCALE RC ROCK CRAWLERS',
    subtitle: 'Engineered for extreme trails, boulder crawling, and technical articulation with portal axles and locked differentials.',
    breadcrumb: 'Rock Crawlers',
  },
  'bashers': {
    title: 'HIGH-SPEED BASHERS & TRUCKS',
    subtitle: 'Brushless power plants built to launch off ramps, endure violent rollovers, and dominate dirt tracks.',
    breadcrumb: 'Bashers',
  },
  'drift': {
    title: 'RC DRIFT MACHINES',
    subtitle: 'RWD and AWD drift chassis configured with precision steering angles and hard compound tires for sideways control.',
    breadcrumb: 'Drift Cars',
  },
  'construction': {
    title: 'HEAVY RC CONSTRUCTION',
    subtitle: 'All-metal hydraulic and electric excavators, dump trucks, and wheel loaders with working functional attachments.',
    breadcrumb: 'Construction',
  },
  'marine': {
    title: 'HIGH-SPEED RC BOATS',
    subtitle: 'Water-cooled brushless speedboats and scale catamaran racing hulls built for calm lakes and offshore action.',
    breadcrumb: 'Boats & Marine',
  },
  'spare-parts': {
    title: 'GENUINE RC SPARE PARTS',
    subtitle: 'Factory OEM replacement gears, brushless ESC combos, high-torque servos, shocks, CVD shafts, and hardware kits.',
    breadcrumb: 'Spare Parts',
  },
  'accessories': {
    title: 'RC ACCESSORIES & GEAR',
    subtitle: 'High-C LiPo batteries, dual smart balance chargers, titanium hex drivers, beadlock wheel sets, and trail winches.',
    breadcrumb: 'Accessories',
  },
};

const QUICK_TABS = [
  { label: 'All Machines', slug: 'all-rc-models' },
  { label: 'Rock Crawlers', slug: 'crawlers' },
  { label: 'Bashers', slug: 'bashers' },
  { label: 'Drift', slug: 'drift' },
  { label: 'Construction', slug: 'construction' },
  { label: 'Marine', slug: 'marine' },
  { label: 'Spare Parts', slug: 'spare-parts' },
  { label: 'Accessories', slug: 'accessories' },
];

export const CollectionPage = ({ forcedCategory }: CollectionPageProps) => {
  const { categorySlug } = useParams<{ categorySlug?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  // Active category can come from prop, route param, or query param
  const activeCategorySlug = forcedCategory || categorySlug || searchParams.get('category') || 'all-rc-models';
  const brandQuery = searchParams.get('brand');

  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<any>({
    ...(brandQuery ? { brand: [brandQuery] } : {}),
    ...(activeCategorySlug !== 'all-rc-models' ? { category: [activeCategorySlug] } : {}),
  });
  const [sort, setSort] = useState('newest');
  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState(false);

  // Sync category changes when route changes
  useEffect(() => {
    if (activeCategorySlug !== 'all-rc-models') {
      setFilters((prev: any) => ({ ...prev, category: [activeCategorySlug] }));
    } else {
      setFilters((prev: any) => {
        const copy = { ...prev };
        delete copy.category;
        return copy;
      });
    }
  }, [activeCategorySlug]);

  useEffect(() => {
    const fetchProducts = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (sort) params.append('sort', sort);

        Object.entries(filters).forEach(([key, value]: [string, any]) => {
          if (Array.isArray(value) && value.length > 0) {
            params.append(key, value[0]);
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

  const currentMeta = CATEGORY_META[activeCategorySlug] || {
    title: `${activeCategorySlug.toUpperCase().replace('-', ' ')} COLLECTION`,
    subtitle: 'Engineered for performance and durability by authorized manufacturers.',
    breadcrumb: activeCategorySlug.replace('-', ' '),
  };

  return (
    <div className="pt-32 pb-24 min-h-screen">
      <div className="container px-4 md:px-6">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground mb-6 [word-spacing:0.15em]">
          <Link to="/" className="hover:text-white transition-colors">Home</Link>
          <span>/</span>
          <Link to="/collections/all-rc-models" className="hover:text-white transition-colors">Collections</Link>
          <span>/</span>
          <span className="text-white">{currentMeta.breadcrumb}</span>
          {brandQuery && (
            <>
              <span>/</span>
              <span className="text-accent uppercase">Brand: {brandQuery}</span>
            </>
          )}
        </div>

        {/* Page Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-accent font-mono text-xs font-bold uppercase tracking-[0.3em] [word-spacing:0.2em]">
              Verified Inventory
            </span>
            <span className="bg-white/10 text-white/80 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
              {products.length} Units Available
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl mb-3 leading-tight [word-spacing:0.25em]">
            {currentMeta.title}
          </h1>
          <p className="text-muted-foreground text-sm sm:text-base md:text-lg max-w-3xl leading-relaxed italic [word-spacing:0.12em]">
            {currentMeta.subtitle}
          </p>
        </div>

        {/* Quick Category Switcher Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-3 mb-8 border-b border-white/5">
          {QUICK_TABS.map((tab) => {
            const isActive = activeCategorySlug === tab.slug;
            return (
              <Link
                key={tab.slug}
                to={tab.slug === 'all-rc-models' ? '/collections/all-rc-models' : `/collections/${tab.slug}`}
                className={cn(
                  "px-4 py-2 text-xs font-black uppercase tracking-wider italic rounded-sm whitespace-nowrap transition-all border",
                  isActive
                    ? "bg-accent border-accent text-white shadow-lg shadow-accent/20"
                    : "bg-white/[0.03] border-white/10 text-muted-foreground hover:border-white/30 hover:text-white"
                )}
              >
                <span className="skew-x-[10deg] block [word-spacing:0.15em]">{tab.label}</span>
              </Link>
            );
          })}
        </div>

        {/* Toolbar */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 mb-12 py-5 border-y border-white/5">
          <div className="flex items-center gap-4 w-full md:w-auto justify-between md:justify-start">
            <button 
              onClick={() => setIsFilterDrawerOpen(true)}
              className="lg:hidden flex items-center gap-2 text-[10px] font-black uppercase tracking-widest italic border border-white/10 px-4 py-2.5 rounded-sm hover:bg-white hover:text-black transition-all"
            >
              <SlidersHorizontal size={14} /> Filter & Sort
            </button>
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground [word-spacing:0.15em]">
              Showing {products.length} Machines & Parts
            </span>
          </div>

          <div className="flex items-center gap-4 w-full md:w-auto justify-between md:justify-end border-t border-white/5 pt-4 md:border-0 md:pt-0">
            <label className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground [word-spacing:0.15em]">
              Sort By:
            </label>
            <div className="relative group">
              <select 
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className="bg-card text-[10px] font-black uppercase tracking-widest italic border border-white/10 rounded-sm focus:ring-accent cursor-pointer appearance-none pr-8 pl-3 py-2"
              >
                <option value="newest" className="bg-card">Newest Arrivals</option>
                <option value="price-low-high" className="bg-card">Price: Low to High</option>
                <option value="price-high-low" className="bg-card">Price: High to Low</option>
                <option value="name-az" className="bg-card">Name: A-Z</option>
              </select>
              <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
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
              <div className="py-20 text-center glass-card p-12 border border-white/5">
                <div className="w-16 h-16 mx-auto mb-4 bg-white/5 rounded-full flex items-center justify-center text-muted-foreground">
                  <SlidersHorizontal size={24} />
                </div>
                <h3 className="text-xl md:text-2xl mb-2 italic [word-spacing:0.2em]">NO MACHINES FOUND</h3>
                <p className="text-muted-foreground text-xs md:text-sm mb-6 max-w-md mx-auto italic [word-spacing:0.12em]">
                  We couldn't find any machines matching your active filter criteria. Try clearing filters or exploring another category.
                </p>
                <button 
                  onClick={() => setFilters({})}
                  className="btn-primary"
                >
                  <span className="skew-x-[10deg] [word-spacing:0.15em]">Clear All Filters</span>
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
                <h2 className="text-lg font-black italic tracking-normal uppercase [word-spacing:0.2em]">Filter & Sort</h2>
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
                  <span className="skew-x-[10deg] [word-spacing:0.15em]">Show {products.length} Results</span>
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

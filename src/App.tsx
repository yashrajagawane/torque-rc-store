import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AnnouncementBar, Header } from './components/layout/Header';
import { Footer } from './components/layout/Footer';
import { Hero } from './components/home/Hero';
import { CategoryShowcase } from './components/home/CategoryShowcase';
import { BrandStrip } from './components/home/BrandStrip';
import { FeaturedProducts } from './components/home/FeaturedProducts';
import { CollectionPage } from './pages/CollectionPage';
import { ProductDetailPage } from './pages/ProductDetailPage';
import { MobileBottomNav } from './components/layout/MobileBottomNav';
import { CartDrawer } from './components/cart/CartDrawer';
import { SearchOverlay } from './components/search/SearchOverlay';
import { useEffect, useState } from 'react';

const ScrollToTop = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
};

const HomePage = () => (
  <>
    <Hero />
    <BrandStrip />
    <CategoryShowcase />
    <FeaturedProducts />
    
    <section className="py-24 bg-accent text-white overflow-hidden relative">
      <div className="container px-4 md:px-6 relative z-10">
        <div className="max-w-2xl">
          <h2 className="text-5xl md:text-7xl mb-8 leading-tight text-white italic">READY TO DOMINATE ANY TERRAIN?</h2>
          <p className="text-white/80 text-xl mb-12 italic font-bold">
            Join thousands of RC enthusiasts who trust RC MEGA for premium machines and expert support.
          </p>
          <a href="/contact" className="bg-black text-white font-black uppercase italic tracking-widest px-10 py-5 rounded-sm skew-x-[-10deg] transition-all hover:bg-white hover:text-black inline-block">
            <span className="skew-x-[10deg] block">Get Expert Advice</span>
          </a>
        </div>
      </div>
      
      <div className="absolute top-1/2 right-0 -translate-y-1/2 translate-x-1/4 opacity-10 pointer-events-none whitespace-nowrap">
        <span className="text-[20vw] font-black italic tracking-tighter uppercase leading-none">RC MEGA</span>
      </div>
    </section>
  </>
);

const NotFound = () => (
  <div className="pt-40 pb-24 container flex flex-col items-center justify-center text-center">
    <h1 className="text-6xl mb-4 italic leading-tight">GARAGE UNDER CONSTRUCTION</h1>
    <p className="text-muted-foreground text-xl mb-8 italic">This area of the garage is currently being optimized for performance.</p>
    <a href="/" className="btn-primary">
      <span className="skew-x-[10deg]">Back to Showroom</span>
    </a>
  </div>
);

const ProductDetailWrapper = () => {
  const location = useLocation();
  const slug = location.pathname.split('/')[2];
  return <ProductDetailPage slug={slug} />;
};

export default function App() {
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  return (
    <BrowserRouter>
      <ScrollToTop />
      <div className="min-h-screen bg-background flex flex-col pb-16 lg:pb-0">
        <AnnouncementBar />
        <Header onOpenCart={() => setIsCartOpen(true)} onOpenSearch={() => setIsSearchOpen(true)} />
        
        <main className="flex-grow">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/collections/all-rc-models" element={<CollectionPage />} />
            <Route path="/products/:slug" element={<ProductDetailWrapper />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>

        <Footer />
        <MobileBottomNav onSearchClick={() => setIsSearchOpen(true)} />
        
        <CartDrawer isOpen={isCartOpen} onClose={() => setIsCartOpen(false)} />
        <SearchOverlay isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
      </div>
    </BrowserRouter>
  );
}

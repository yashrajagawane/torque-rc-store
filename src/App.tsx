import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { Header } from './components/layout/Header';

import { Footer } from './components/layout/Footer';
import { Hero } from './components/home/Hero';
import { CategoryShowcase } from './components/home/CategoryShowcase';
import { BrandStrip } from './components/home/BrandStrip';
import { FeaturedProducts } from './components/home/FeaturedProducts';
import { CollectionPage } from './pages/CollectionPage';
import { ProductDetailPage } from './pages/ProductDetailPage';
import { AccountDashboardPage } from './pages/AccountDashboardPage';
import { BrandsPage } from './pages/BrandsPage';
import { AboutPage } from './pages/AboutPage';
import { ContactPage } from './pages/ContactPage';
import { WishlistPage } from './pages/WishlistPage';
import { MobileBottomNav } from './components/layout/MobileBottomNav';
import { CartDrawer } from './components/cart/CartDrawer';
import { SearchOverlay } from './components/search/SearchOverlay';
import { useEffect, useState } from 'react';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth } from './auth/RequireAuth';
import { AuthCallbackPage, LoginPage, PasswordRecoveryPage, PasswordResetPage, RegisterPage } from './pages/AuthPages';
import { RequireOwner } from './auth/RequireOwner';
import { AdminProductsPage } from './pages/AdminProductsPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { AdminOrdersPage } from './pages/AdminOrdersPage';
import { CartSync } from './cart/CartSync';

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
    
    <section className="py-20 bg-accent text-white overflow-hidden relative">
      <div className="container px-4 md:px-6 relative z-10">
        <div className="max-w-2xl">
          <span className="text-white/80 font-mono text-xs font-bold uppercase tracking-[0.3em] block mb-3 [word-spacing:0.2em]">
            Join The Circuit
          </span>
          <h2 className="text-2xl sm:text-3xl md:text-4xl mb-5 leading-tight text-white italic [word-spacing:0.25em]">
            READY TO DOMINATE ANY TERRAIN?
          </h2>
          <p className="text-white/90 text-sm sm:text-base md:text-lg mb-8 italic font-medium leading-relaxed [word-spacing:0.12em]">
            Join thousands of RC enthusiasts who trust RC MEGA for precision machines and certified pit crew support.
          </p>
          <a href="/contact" className="bg-black text-white font-black uppercase italic tracking-wider px-8 py-4 rounded-sm skew-x-[-10deg] transition-all hover:bg-white hover:text-black inline-block [word-spacing:0.15em]">
            <span className="skew-x-[10deg] block">Get Expert Advice</span>
          </a>
        </div>
      </div>
      
      <div className="absolute top-1/2 right-0 -translate-y-1/2 translate-x-1/4 opacity-5 pointer-events-none whitespace-nowrap">
        <span className="text-[16vw] font-black italic tracking-widest uppercase leading-none">RC MEGA</span>
      </div>
    </section>
  </>
);

const NotFound = () => (
  <div className="pt-40 pb-24 container flex flex-col items-center justify-center text-center">
    <h1 className="text-3xl md:text-4xl mb-4 italic leading-tight [word-spacing:0.25em]">GARAGE UNDER CONSTRUCTION</h1>
    <p className="text-muted-foreground text-sm sm:text-base md:text-lg mb-8 italic [word-spacing:0.12em]">
      This area of the garage is currently being calibrated for maximum performance.
    </p>
    <a href="/" className="btn-primary [word-spacing:0.15em]">
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
        <AuthProvider>
        <CartSync />
        <Header onOpenCart={() => setIsCartOpen(true)} onOpenSearch={() => setIsSearchOpen(true)} />
        
        <main className="flex-grow">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/collections/all-rc-models" element={<CollectionPage />} />
            <Route path="/collections/spare-parts" element={<CollectionPage forcedCategory="spare-parts" />} />
            <Route path="/collections/accessories" element={<CollectionPage forcedCategory="accessories" />} />
            <Route path="/collections/:categorySlug" element={<CollectionPage />} />
            <Route path="/products/:slug" element={<ProductDetailWrapper />} />
            <Route path="/brands" element={<BrandsPage />} />
            <Route path="/brands/:brandSlug" element={<BrandsPage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/contact" element={<ContactPage />} />
            <Route path="/wishlist" element={<WishlistPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/forgot-password" element={<PasswordRecoveryPage />} />
            <Route path="/account/reset-password" element={<PasswordResetPage />} />
            <Route path="/auth/callback" element={<AuthCallbackPage />} />
            <Route path="/account" element={<RequireAuth><AccountDashboardPage /></RequireAuth>} />
            <Route path="/checkout" element={<RequireAuth><CheckoutPage /></RequireAuth>} />
            <Route path="/admin" element={<RequireOwner><AdminProductsPage /></RequireOwner>} />
            <Route path="/admin/orders" element={<RequireOwner><AdminOrdersPage /></RequireOwner>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>

        <Footer />
        <MobileBottomNav onSearchClick={() => setIsSearchOpen(true)} />
        
        <CartDrawer isOpen={isCartOpen} onClose={() => setIsCartOpen(false)} />
        <SearchOverlay isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
        </AuthProvider>
      </div>
    </BrowserRouter>
  );
}

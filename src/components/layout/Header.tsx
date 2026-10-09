import { useState, useEffect } from 'react';
import { ShoppingCart, Heart, Search, Menu, X, User } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../../lib/utils';
import { useWishlistStore } from '../../store/wishlistStore';
import { CartDrawer } from '../cart/CartDrawer';
import { SearchOverlay } from '../search/SearchOverlay';
import { useVisibleCart } from '../../cart/useVisibleCart';

export const AnnouncementBar = () => {
  return (
    <div className="bg-primary text-primary-foreground py-1 px-4 text-center text-[9px] md:text-[11px] font-bold tracking-wider uppercase border-b border-white/10 relative z-50 [word-spacing:0.15em]">
      PREMIUM RC MODELS • GENUINE SPARES • EXPERT SUPPORT
      <Link to="/collections/all-rc-models" className="ml-2 underline hover:text-accent transition-colors [word-spacing:0.1em]">
        Explore Collection →
      </Link>
    </div>
  );
};

const NAV_LINKS = [
  { name: 'RC Models', href: '/collections/all-rc-models' },
  { name: 'Spare Parts', href: '/collections/spare-parts' },
  { name: 'Accessories', href: '/collections/accessories' },
  { name: 'Brands', href: '/brands' },
  { name: 'About', href: '/about' },
  { name: 'Contact', href: '/contact' },
];

interface HeaderProps {
  onOpenCart: () => void;
  onOpenSearch: () => void;
}

export const Header = ({ onOpenCart, onOpenSearch }: HeaderProps) => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
  const location = useLocation();
  const { items: cartItems } = useVisibleCart();
  const cartCount = cartItems.reduce((acc, item) => acc + item.quantity, 0);
  const wishlistItems = useWishlistStore((state) => state.items);
  const wishlistCount = wishlistItems.length;

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  return (
    <header className="fixed top-0 left-0 w-full z-50 shadow-md">
      {/* Top Notification Announcement Strip */}
      <AnnouncementBar />

      {/* Main Navigation Bar with Compact Padding & Solid Dark Backdrop Shield */}
      <div
        className={cn(
          'w-full transition-all duration-200 border-b',
          isScrolled
            ? 'bg-background/95 backdrop-blur-md py-2 border-white/10 shadow-xl'
            : 'bg-background/90 md:bg-black/90 backdrop-blur-md py-2.5 md:py-3 border-white/10'
        )}
      >
        <div className="container mx-auto px-4 md:px-6 flex items-center justify-between">
          {/* Left: Logo */}
          <div className="flex items-center gap-6 md:gap-8">
            <Link to="/" className="flex items-center gap-2 group">
              <div className="w-8 h-8 md:w-9 md:h-9 bg-primary flex items-center justify-center rounded-sm skew-x-[-10deg] group-hover:bg-accent transition-colors border border-white/10">
                <span className="text-white font-black text-base md:text-lg skew-x-[10deg]">RM</span>
              </div>
              <span className="text-lg md:text-xl font-black tracking-normal text-white uppercase italic [word-spacing:0.15em]">
                RC<span className="text-accent">MEGA</span>
              </span>
            </Link>

            {/* Desktop Nav */}
            <nav className="hidden lg:flex items-center gap-5 xl:gap-6">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.name}
                  to={link.href}
                  className={cn(
                    "text-xs font-bold uppercase tracking-wider transition-colors py-1",
                    location.pathname === link.href ? "text-accent" : "text-muted-foreground hover:text-white"
                  )}
                >
                  {link.name}
                </Link>
              ))}
            </nav>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-4 md:gap-6">
            <button 
              onClick={onOpenSearch}
              className="text-muted-foreground hover:text-white transition-colors"
            >
              <Search size={20} />
            </button>
            <Link to="/account" className="hidden md:block text-muted-foreground hover:text-white transition-colors">
              <User size={20} />
            </Link>
            <Link to="/wishlist" className="relative text-muted-foreground hover:text-white transition-colors group">
              <Heart size={20} />
              {wishlistCount > 0 && (
                <span className="absolute -top-2 -right-2 bg-accent text-white text-[10px] font-black w-4 h-4 flex items-center justify-center rounded-full italic">
                  {wishlistCount}
                </span>
              )}
            </Link>
            <button 
              onClick={onOpenCart}
              className="relative text-muted-foreground hover:text-white transition-colors group"
            >
              <ShoppingCart size={20} />
              {cartCount > 0 && (
                <span className="absolute -top-2 -right-2 bg-accent text-white text-[10px] font-black w-4 h-4 flex items-center justify-center rounded-full italic">
                  {cartCount}
                </span>
              )}
            </button>
            <button
              className="lg:hidden text-white"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            >
              {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>

        {/* Mobile Menu Overlay */}
        <AnimatePresence>
          {isMobileMenuOpen && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="lg:hidden absolute top-full left-0 w-full bg-card border-b border-white/5 overflow-hidden shadow-2xl"
            >
              <nav className="flex flex-col p-6 space-y-4">
                {NAV_LINKS.map((link) => (
                  <Link
                    key={link.name}
                    to={link.href}
                    className="text-sm font-black uppercase tracking-widest text-muted-foreground hover:text-white transition-colors py-3 border-b border-white/5 italic"
                  >
                    {link.name}
                  </Link>
                ))}
                <div className="flex gap-4 pt-4">
                  <Link to="/account" className="flex-grow btn-secondary py-3 flex items-center justify-center">
                    <span className="skew-x-[10deg] flex items-center gap-2"><User size={16} /> Account</span>
                  </Link>
                  <Link to="/wishlist" className="w-12 h-12 border border-white/10 flex items-center justify-center rounded-sm skew-x-[-10deg]">
                    <span className="skew-x-[10deg]"><Heart size={20} /></span>
                  </Link>
                </div>
              </nav>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
};

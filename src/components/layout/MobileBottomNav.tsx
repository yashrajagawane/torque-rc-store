import { Home, Search, LayoutGrid, Heart, ShoppingBag } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '../../lib/utils';
import { useVisibleCart } from '../../cart/useVisibleCart';
import { useWishlistStore } from '../../store/wishlistStore';

export const MobileBottomNav = ({ onSearchClick }: { onSearchClick: () => void }) => {
  const location = useLocation();
  const { items: cartItems } = useVisibleCart();
  const cartCount = cartItems.reduce((acc, item) => acc + item.quantity, 0);
  const wishlistItems = useWishlistStore((state) => state.items);
  const wishlistCount = wishlistItems.length;

  const navItems = [
    { icon: Home, label: 'Home', href: '/' },
    { icon: Search, label: 'Search', onClick: onSearchClick },
    { icon: LayoutGrid, label: 'Models', href: '/collections/all-rc-models' },
    { icon: Heart, label: 'Wishlist', href: '/wishlist', count: wishlistCount },
    { icon: ShoppingBag, label: 'Garage', href: '/cart', count: cartCount },
  ];

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 w-full bg-background/95 backdrop-blur-md border-t border-white/5 z-50 px-2 pb-safe">
      <div className="flex items-center justify-around h-16">
        {navItems.map((item, idx) => {
          const isActive = location.pathname === item.href;
          const Icon = item.icon;

          if (item.onClick) {
            return (
              <button
                key={idx}
                onClick={item.onClick}
                className="flex flex-col items-center justify-center gap-1 w-full text-muted-foreground hover:text-white transition-colors"
              >
                <Icon size={20} />
                <span className="text-[8px] font-black uppercase tracking-widest italic">{item.label}</span>
              </button>
            );
          }

          return (
            <Link
              key={idx}
              to={item.href || '#'}
              className={cn(
                "flex flex-col items-center justify-center gap-1 w-full transition-all relative",
                isActive ? "text-accent" : "text-muted-foreground hover:text-white"
              )}
            >
              <div className="relative">
                <Icon size={20} />
                {item.count !== undefined && item.count > 0 && (
                  <span className="absolute -top-2 -right-2 bg-accent text-white text-[8px] font-black w-4 h-4 flex items-center justify-center rounded-full italic">
                    {item.count}
                  </span>
                )}
              </div>
              <span className="text-[8px] font-black uppercase tracking-widest italic">{item.label}</span>
              {isActive && (
                <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-accent rounded-full" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
};

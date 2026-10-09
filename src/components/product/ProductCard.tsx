import { Link } from 'react-router-dom';
import { Heart, ShoppingCart, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn, formatCurrency } from '../../lib/utils';
import { useCartStore } from '../../store/cartStore';
import { useWishlistStore } from '../../store/wishlistStore';
import { useVisibleCart } from '../../cart/useVisibleCart';

interface ProductCardProps {
  id: number;
  slug: string;
  name: string;
  price: string;
  thumbnail: string;
  brandName?: string;
  scale?: string;
  terrain?: string;
  availability?: string;
  featured?: boolean;
}

export const ProductCard = ({
  id,
  slug,
  name,
  price,
  thumbnail,
  brandName,
  scale,
  terrain,
  availability,
  featured,
}: ProductCardProps) => {
  const addItem = useCartStore((state) => state.addItem);
  const { visibility } = useVisibleCart();
  const storeCartLocked = useCartStore((state) => Boolean(state.pendingMerge || state.legacyMergeKey || (state.mode === 'guest' && state.guestItemsOwnerId)));
  const cartLocked = visibility === 'loading' || visibility === 'recovery' || storeCartLocked;
  const toggleWishlist = useWishlistStore((state) => state.toggleItem);
  const isWishlisted = useWishlistStore((state) => state.isInWishlist(id));

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault();
    addItem({
      id,
      slug,
      name,
      price,
      thumbnail,
      quantity: 1,
      brandName,
      availability
    });
  };

  const handleToggleWishlist = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    toggleWishlist({
      id,
      slug,
      name,
      price,
      thumbnail,
      brandName,
      scale,
      terrain,
      availability,
    });
  };

  return (
    <motion.div
      whileHover={{ y: -10 }}
      className="glass-card group flex flex-col h-full bg-[#0a0a0a]"
    >
      <Link to={`/products/${slug}`} className="relative block aspect-[4/3] overflow-hidden">
        <img
          src={thumbnail}
          alt={name}
          className="w-full h-full object-contain transition-transform duration-700 group-hover:scale-110 p-6"
          referrerPolicy="no-referrer"
        />
        
        {/* Badges */}
        <div className="absolute top-4 left-4 flex flex-col gap-2">
          {featured && (
            <span className="bg-accent text-white text-[9px] font-black uppercase italic px-2 py-1 tracking-wider">
              POPULAR
            </span>
          )}
          {availability === 'ON_ORDER' && (
            <span className="bg-white text-black text-[9px] font-black uppercase italic px-2 py-1 tracking-wider">
              ON ORDER
            </span>
          )}
        </div>

        <button 
          onClick={handleToggleWishlist}
          title={isWishlisted ? "Remove from Wishlist" : "Add to Wishlist"}
          className={cn(
            "absolute top-4 right-4 w-10 h-10 rounded-full flex items-center justify-center transition-all z-10",
            isWishlisted
              ? "bg-accent text-white opacity-100 shadow-lg scale-105"
              : "bg-black/50 backdrop-blur-md text-white opacity-0 group-hover:opacity-100 hover:bg-accent"
          )}
        >
          <Heart size={18} fill={isWishlisted ? "currentColor" : "none"} />
        </button>
      </Link>

      <div className="p-4 md:p-6 flex flex-col flex-grow">
        <div className="mb-1 md:mb-2">
          <span className="text-[8px] md:text-[10px] font-black uppercase tracking-[0.2em] text-accent italic">
            {brandName}
          </span>
        </div>
        <h3 className="text-sm md:text-base font-bold mb-2 line-clamp-1 leading-tight tracking-normal italic [word-spacing:0.18em]">
          <Link to={`/products/${slug}`} className="hover:text-accent transition-colors">
            {name}
          </Link>
        </h3>
        
        <div className="flex items-center gap-1.5 md:gap-2 mb-4 text-[8px] md:text-[10px] text-muted-foreground font-semibold uppercase tracking-wider [word-spacing:0.1em]">
          {scale && <span>{scale}</span>}
          {scale && terrain && <span className="text-white/10">•</span>}
          {terrain && <span className="truncate">{terrain}</span>}
        </div>

        <div className="mt-auto flex items-center justify-between pt-4 border-t border-white/5">
          <span className="text-base md:text-lg font-black italic tracking-normal [word-spacing:0.15em]">
            {formatCurrency(price)}
          </span>
          <button 
            onClick={handleAddToCart}
            disabled={cartLocked}
            title={cartLocked ? 'Cart recovery is in progress' : 'Add to cart'}
            className="w-8 h-8 md:w-10 md:h-10 bg-white text-black flex items-center justify-center rounded-sm skew-x-[-10deg] hover:bg-accent hover:text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <div className="skew-x-[10deg]">
              <ShoppingCart size={16} className="md:w-[18px]" />
            </div>
          </button>
        </div>
      </div>
    </motion.div>
  );
};

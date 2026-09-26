import { Link } from 'react-router-dom';
import { Heart, ShoppingCart, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn, formatCurrency } from '../../lib/utils';
import { useCartStore } from '../../store/cartStore';

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

        <button className="absolute top-4 right-4 w-10 h-10 bg-black/50 backdrop-blur-md rounded-full flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-accent">
          <Heart size={18} />
        </button>
      </Link>

      <div className="p-4 md:p-6 flex flex-col flex-grow">
        <div className="mb-1 md:mb-2">
          <span className="text-[8px] md:text-[10px] font-black uppercase tracking-[0.2em] text-accent italic">
            {brandName}
          </span>
        </div>
        <h3 className="text-sm md:text-lg font-black mb-2 line-clamp-1 leading-tight tracking-tight italic">
          <Link to={`/products/${slug}`} className="hover:text-accent transition-colors">
            {name}
          </Link>
        </h3>
        
        <div className="flex items-center gap-1.5 md:gap-2 mb-4 text-[8px] md:text-[10px] text-muted-foreground font-bold uppercase tracking-widest">
          {scale && <span>{scale}</span>}
          {scale && terrain && <span className="text-white/10">•</span>}
          {terrain && <span className="truncate">{terrain}</span>}
        </div>

        <div className="mt-auto flex items-center justify-between pt-4 border-t border-white/5">
          <span className="text-lg md:text-xl font-black italic tracking-tighter">
            {formatCurrency(price)}
          </span>
          <button 
            onClick={handleAddToCart}
            className="w-8 h-8 md:w-10 md:h-10 bg-white text-black flex items-center justify-center rounded-sm skew-x-[-10deg] hover:bg-accent hover:text-white transition-all"
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

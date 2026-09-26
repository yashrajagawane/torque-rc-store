import { Link } from 'react-router-dom';
import { Heart, ShoppingCart, Trash2, ArrowRight, ArrowLeft } from 'lucide-react';
import { useWishlistStore } from '../store/wishlistStore';
import { useCartStore } from '../store/cartStore';
import { formatCurrency } from '../lib/utils';

export const WishlistPage = () => {
  const items = useWishlistStore((state) => state.items);
  const removeItem = useWishlistStore((state) => state.removeItem);
  const clearWishlist = useWishlistStore((state) => state.clearWishlist);
  const addItemToCart = useCartStore((state) => state.addItem);

  const handleMoveToCart = (item: any) => {
    addItemToCart({
      id: item.id,
      slug: item.slug,
      name: item.name,
      price: item.price,
      thumbnail: item.thumbnail,
      quantity: 1,
      brandName: item.brandName,
      availability: item.availability,
    });
    removeItem(item.id);
  };

  return (
    <div className="pt-32 pb-24 min-h-screen">
      <div className="container px-4 md:px-6">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground mb-6 [word-spacing:0.15em]">
          <Link to="/" className="hover:text-white transition-colors">Home</Link>
          <span>/</span>
          <span className="text-white">Pilot Wishlist</span>
        </div>

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 pb-6 border-b border-white/5 mb-10">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-accent font-mono text-xs font-bold uppercase tracking-[0.3em] [word-spacing:0.2em]">
                Saved Machines & Parts
              </span>
              <span className="bg-white/10 text-white/80 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                {items.length} Saved
              </span>
            </div>
            <h1 className="text-3xl sm:text-4xl md:text-5xl leading-tight [word-spacing:0.25em]">
              YOUR SAVED GARAGE
            </h1>
          </div>

          {items.length > 0 && (
            <button
              onClick={clearWishlist}
              className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest hover:text-accent transition-colors self-start sm:self-auto [word-spacing:0.15em]"
            >
              Clear Entire Wishlist
            </button>
          )}
        </div>

        {items.length === 0 ? (
          <div className="py-24 text-center glass-card p-12 border border-white/5 max-w-xl mx-auto">
            <div className="w-16 h-16 mx-auto mb-4 bg-white/5 rounded-full flex items-center justify-center text-muted-foreground">
              <Heart size={28} />
            </div>
            <h3 className="text-xl md:text-2xl mb-2 italic [word-spacing:0.2em]">YOUR WISHLIST IS EMPTY</h3>
            <p className="text-muted-foreground text-xs md:text-sm mb-8 italic leading-relaxed [word-spacing:0.12em]">
              You haven't bookmarked any machines or parts yet. Explore our showroom and tap the heart icon on any vehicle to save it to your telemetry list.
            </p>
            <Link to="/collections/all-rc-models" className="btn-primary inline-flex items-center gap-2">
              <span className="skew-x-[10deg] [word-spacing:0.15em]">Explore RC Showroom</span>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {items.map((item) => (
              <div
                key={item.id}
                className="glass-card flex flex-col justify-between border border-white/5 bg-[#0a0a0a] group"
              >
                <div>
                  <Link to={`/products/${item.slug}`} className="block aspect-[4/3] p-6 relative overflow-hidden bg-black/40">
                    <img
                      src={item.thumbnail}
                      alt={item.name}
                      className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-500"
                    />
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        removeItem(item.id);
                      }}
                      title="Remove from wishlist"
                      className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/60 border border-white/10 flex items-center justify-center text-muted-foreground hover:text-accent hover:border-accent transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </Link>

                  <div className="p-5">
                    {item.brandName && (
                      <span className="text-[9px] font-black uppercase tracking-[0.2em] text-accent italic block mb-1">
                        {item.brandName}
                      </span>
                    )}
                    <h3 className="text-sm font-bold italic line-clamp-1 mb-2 [word-spacing:0.15em]">
                      <Link to={`/products/${item.slug}`} className="hover:text-accent transition-colors">
                        {item.name}
                      </Link>
                    </h3>

                    <div className="flex items-center gap-2 text-[9px] text-muted-foreground font-semibold uppercase tracking-wider mb-4 [word-spacing:0.1em]">
                      {item.scale && <span>{item.scale}</span>}
                      {item.scale && item.terrain && <span>•</span>}
                      {item.terrain && <span className="truncate">{item.terrain}</span>}
                    </div>

                    <div className="text-base font-black italic tracking-normal text-white mb-4 [word-spacing:0.15em]">
                      {formatCurrency(item.price)}
                    </div>
                  </div>
                </div>

                <div className="p-5 pt-0 border-t border-white/5 mt-auto">
                  <button
                    onClick={() => handleMoveToCart(item)}
                    className="btn-primary w-full py-3 text-xs flex items-center justify-center gap-2"
                  >
                    <span className="skew-x-[10deg] flex items-center gap-2 [word-spacing:0.15em]">
                      <ShoppingCart size={14} /> Move to Garage Cart
                    </span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

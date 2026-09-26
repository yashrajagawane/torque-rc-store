import { useState, useEffect } from 'react';
import { ShoppingCart, Heart, ArrowLeft, Truck, ShieldCheck, Zap, Info } from 'lucide-react';
import { formatCurrency, cn } from '../lib/utils';
import { useCartStore } from '../store/cartStore';

export const ProductDetailPage = ({ slug }: { slug: string }) => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [quantity, setQuantity] = useState(1);
  const addItem = useCartStore((state) => state.addItem);

  useEffect(() => {
    const fetchProduct = async () => {
      try {
        const response = await fetch(`/api/products/${slug}`);
        const json = await response.json();
        setData(json);
      } catch (error) {
        console.error('Error fetching product:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchProduct();
  }, [slug]);

  if (loading) return <div className="pt-40 container text-center">Loading Machine...</div>;
  if (!data) return <div className="pt-40 container text-center">Machine Not Found</div>;

  const { product, brandName, categoryName } = data;

  const handleAddToCart = () => {
    addItem({
      id: product.id,
      slug: product.slug,
      name: product.name,
      price: product.price,
      thumbnail: product.thumbnail,
      quantity: quantity,
      brandName: brandName,
      availability: product.availability
    });
  };

  return (
    <div className="pt-24 md:pt-32 pb-24">
      <div className="container px-4 md:px-6">
        {/* Breadcrumb - Hide on mobile if too long */}
        <div className="hidden md:flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground mb-8">
          <a href="/" className="hover:text-white transition-colors">Home</a>
          <span>/</span>
          <a href="/collections/all-rc-models" className="hover:text-white transition-colors">RC Models</a>
          <span>/</span>
          <span className="text-white truncate max-w-[200px]">{product.name}</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 md:gap-16 items-start">
          {/* Gallery */}
          <div className="space-y-4 md:space-y-6">
             <div className="aspect-square md:aspect-[4/3] bg-[#0a0a0a] border border-white/5 rounded-sm overflow-hidden p-6 md:p-8 flex items-center justify-center">
                <img 
                  src={product.thumbnail} 
                  alt={product.name} 
                  className="w-full h-full object-contain"
                  referrerPolicy="no-referrer"
                />
             </div>
             <div className="grid grid-cols-4 gap-2 md:gap-4">
               {product.images?.map((img: string, idx: number) => (
                 <div key={idx} className="aspect-square bg-[#0a0a0a] border border-white/5 rounded-sm p-1 md:p-2 flex items-center justify-center cursor-pointer hover:border-accent transition-colors">
                    <img src={img} alt={`${product.name} ${idx}`} className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                 </div>
               ))}
             </div>
          </div>

          {/* Info */}
          <div className="flex flex-col">
            <div className="mb-2 md:mb-4">
              <span className="text-[10px] md:text-xs font-black uppercase tracking-[0.4em] text-accent italic">
                {brandName}
              </span>
            </div>
            <h1 className="text-3xl md:text-6xl mb-4 md:mb-6 leading-tight italic">{product.name}</h1>
            
            <div className="flex items-center gap-4 md:gap-6 mb-6 md:mb-8">
              <span className="text-2xl md:text-3xl font-black italic tracking-tighter">
                {formatCurrency(product.price)}
              </span>
              {product.compareAtPrice && (
                <span className="text-lg md:text-xl text-muted-foreground line-through italic decoration-accent decoration-2 underline-offset-4">
                  {formatCurrency(product.compareAtPrice)}
                </span>
              )}
            </div>

            <p className="text-muted-foreground text-base md:text-lg mb-8 leading-relaxed italic border-l-2 border-accent pl-4 md:pl-6">
              {product.description}
            </p>

            {/* Quick Specs - Optimized for small screens */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-y-6 gap-x-4 mb-8 py-6 border-y border-white/5">
              {[
                { label: 'Scale', value: product.scale },
                { label: 'Terrain', value: product.terrain },
                { label: 'Drive', value: product.driveType },
                { label: 'Battery', value: product.batteryType },
                { label: 'Skill', value: product.skillLevel },
                { label: 'Material', value: product.material },
              ].map((spec) => (
                <div key={spec.label} className="flex flex-col">
                  <span className="text-[8px] md:text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">{spec.label}</span>
                  <span className="text-[10px] md:text-xs font-bold uppercase tracking-widest text-white truncate">{spec.value || 'N/A'}</span>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="space-y-4 md:space-y-6 mb-12">
              <div className="flex flex-col sm:flex-row items-stretch gap-4">
                <div className="flex items-center justify-between bg-[#111] rounded-sm skew-x-[-10deg] border border-white/10 px-4 h-14">
                  <button 
                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                    className="w-10 h-full text-white hover:text-accent transition-colors skew-x-[10deg] text-xl"
                  >-</button>
                  <span className="font-bold text-base skew-x-[10deg]">{quantity}</span>
                  <button 
                    onClick={() => setQuantity(quantity + 1)}
                    className="w-10 h-full text-white hover:text-accent transition-colors skew-x-[10deg] text-xl"
                  >+</button>
                </div>
                <button 
                  onClick={handleAddToCart}
                  className="btn-primary flex-grow h-14 flex items-center justify-center gap-3"
                >
                  <span className="skew-x-[10deg] flex items-center gap-2">
                    <ShoppingCart size={20} /> ADD TO GARAGE
                  </span>
                </button>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch gap-4">
                 <button className="flex-grow bg-[#111] text-white border border-white/10 font-black uppercase italic tracking-widest h-14 rounded-sm skew-x-[-10deg] hover:bg-white hover:text-black transition-all">
                    <span className="skew-x-[10deg]">Order via WhatsApp</span>
                 </button>
                 <button className="h-14 sm:w-14 border border-white/10 flex items-center justify-center rounded-sm skew-x-[-10deg] hover:border-accent hover:text-accent transition-all">
                    <span className="skew-x-[10deg]"><Heart size={20} /></span>
                 </button>
              </div>
            </div>

            {/* Benefits */}
            <div className="grid grid-cols-3 gap-2 md:gap-6 pt-6">
              {[
                { icon: Truck, label: 'Worldwide\nShipping' },
                { icon: ShieldCheck, label: 'Genuine\nGuarantee' },
                { icon: Zap, label: 'Expert\nSupport' },
              ].map((item, i) => (
                <div key={i} className="flex flex-col items-center text-center gap-2">
                  <item.icon size={18} className="text-accent" />
                  <span className="text-[8px] md:text-[10px] font-black uppercase tracking-widest text-muted-foreground leading-tight whitespace-pre-line">
                    {item.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Technical Specs Tab */}
        <div className="mt-20 md:mt-24">
           <div className="flex items-center gap-4 md:gap-8 border-b border-white/5 mb-8 md:mb-12 overflow-x-auto no-scrollbar">
              <button className="text-[10px] md:text-xs font-black uppercase tracking-[0.2em] italic pb-4 border-b-2 border-accent whitespace-nowrap">Product Overview</button>
              <button className="text-[10px] md:text-xs font-black uppercase tracking-[0.2em] italic pb-4 border-b-2 border-transparent text-muted-foreground hover:text-white whitespace-nowrap">Technical Details</button>
              <button className="text-[10px] md:text-xs font-black uppercase tracking-[0.2em] italic pb-4 border-b-2 border-transparent text-muted-foreground hover:text-white whitespace-nowrap">In the Box</button>
           </div>
           
           <div className="max-w-4xl italic text-muted-foreground leading-relaxed text-lg">
              <p className="mb-6">
                 This precision-engineered {product.name} is designed for enthusiasts who demand the highest level of performance and durability. With its {product.scale} scale presence and {product.driveType} drivetrain, it masters {product.terrain} terrain with ease.
              </p>
              <p>
                 Crafted from high-quality {product.material}, every component is optimized for weight and strength. Whether you're a seasoned racer or a beginner looking to enter the world of high-performance RC, the {product.name} delivers an unmatched experience of control and thrill.
              </p>
           </div>
        </div>
      </div>
    </div>
  );
};

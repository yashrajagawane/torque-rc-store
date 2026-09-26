import { useState, useEffect } from 'react';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ProductCard } from '../product/ProductCard';

export const FeaturedProducts = () => {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const response = await fetch('/api/products?featured=true');
        const data = await response.json();
        setProducts(data);
      } catch (error) {
        console.error('Failed to fetch featured products:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchProducts();
  }, []);

  if (loading) return null;

  return (
    <section className="py-24 bg-[#050505]">
      <div className="container px-4 md:px-6">
        <div className="flex flex-col md:flex-row items-end justify-between mb-12 gap-6">
          <div>
            <span className="text-accent font-mono text-xs font-bold uppercase tracking-[0.3em] block mb-3 [word-spacing:0.2em]">
              Hand-Picked Selection
            </span>
            <h2 className="text-2xl sm:text-3xl md:text-4xl [word-spacing:0.25em]">POPULAR MACHINES</h2>
          </div>
          <Link to="/collections/all-rc-models" className="group flex items-center gap-3 text-xs font-black uppercase tracking-wider italic hover:text-accent transition-colors [word-spacing:0.15em]">
            View All Products <ArrowRight size={16} className="group-hover:translate-x-2 transition-transform" />
          </Link>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-10 md:gap-6">
          {products.slice(0, 4).map((product) => (
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
              featured={true}
            />
          ))}
        </div>
      </div>
    </section>
  );
};

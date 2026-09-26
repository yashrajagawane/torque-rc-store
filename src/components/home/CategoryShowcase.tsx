import { ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';

const CATEGORIES = [
  {
    name: 'RC CARS',
    slug: 'bashers',
    description: 'On-road • Off-road • Drift',
    image: '/src/assets/images/category_rc_cars_1790434413337.jpg'
  },
  {
    name: 'RC CRAWLERS',
    slug: 'crawlers',
    description: 'Rock crawling • Trail • Scale',
    image: '/src/assets/images/category_rc_crawlers_1790434426807.jpg'
  },
  {
    name: 'RC BOATS',
    slug: 'marine',
    description: 'Speed • Racing • Marine',
    image: '/src/assets/images/category_rc_boats_1790434439161.jpg'
  },
  {
    name: 'CONSTRUCTION',
    slug: 'construction',
    description: 'Excavators • Dumpers • Dozers',
    image: '/src/assets/images/category_construction_1790434453033.jpg'
  },
  {
    name: 'SPARE PARTS',
    slug: 'spare-parts',
    description: 'Gears • Motors • Electronics',
    image: '/src/assets/images/category_parts_1790434472723.jpg'
  },
  {
    name: 'ACCESSORIES',
    slug: 'accessories',
    description: 'Batteries • Tools • Upgrades',
    image: '/src/assets/images/category_accessories_rc_1790434488572.jpg'
  }
];

export const CategoryShowcase = () => {
  return (
    <section className="py-24 bg-background">
      <div className="container px-4 md:px-6">
        <div className="flex flex-col md:flex-row items-end justify-between mb-12 gap-6">
          <div>
            <span className="text-accent font-mono text-xs font-bold uppercase tracking-[0.4em] block mb-4">
              Explore Categories
            </span>
            <h2 className="text-4xl md:text-5xl lg:text-6xl">FIND YOUR MACHINE</h2>
          </div>
          <Link to="/collections/all-rc-models" className="group flex items-center gap-3 text-xs font-black uppercase tracking-widest italic hover:text-accent transition-colors">
            View All Collections <ArrowRight size={16} className="group-hover:translate-x-2 transition-transform" />
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {CATEGORIES.map((cat, idx) => (
            <motion.div
              key={cat.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: idx * 0.1 }}
            >
              <Link
                to={`/collections/${cat.slug}`}
                className="group relative block aspect-[4/3] overflow-hidden rounded-sm bg-[#0a0a0a]"
              >
                <img
                  src={cat.image}
                  alt={cat.name}
                  className="w-full h-full object-cover opacity-60 transition-all duration-700 group-hover:scale-110 group-hover:opacity-100"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent p-8 flex flex-col justify-end">
                  <h3 className="text-2xl md:text-3xl mb-1 italic tracking-tighter">{cat.name}</h3>
                  <p className="text-muted-foreground text-xs font-bold uppercase tracking-widest mb-4">
                    {cat.description}
                  </p>
                  <div className="w-12 h-12 bg-white/10 backdrop-blur-md flex items-center justify-center rounded-sm skew-x-[-10deg] group-hover:bg-accent transition-colors">
                    <ArrowRight size={20} className="text-white skew-x-[10deg]" />
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

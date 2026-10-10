import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import heroImage from '../../assets/images/hero_rc_car_cinematic_1790434394611.jpg';

export const Hero = () => {
  return (
    <section className="relative min-h-[560px] md:min-h-[640px] lg:min-h-[720px] flex flex-col justify-start overflow-hidden pt-28 sm:pt-30 md:pt-32 lg:pt-32 pb-10">
      {/* Background Image with Parallax */}
      <motion.div 
        className="absolute inset-0 z-0"
        initial={{ scale: 1.1 }}
        animate={{ scale: 1 }}
        transition={{ duration: 1.5, ease: "easeOut" }}
      >
        <img 
          src={heroImage}
          alt="Premium RC Rock Crawler" 
          className="w-full h-full object-cover brightness-[0.4]"
          referrerPolicy="no-referrer"
        />
      </motion.div>

      {/* Overlay Content */}
      <div className="container relative z-10 px-4 md:px-6">
        <div className="max-w-2xl">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-accent/20 border border-accent/40 text-accent font-mono text-[11px] sm:text-xs md:text-sm font-bold uppercase tracking-[0.25em] mb-4 shadow-sm backdrop-blur-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              <span>Performance Engineering</span>
            </div>
            <h1 className="text-3xl sm:text-4xl md:text-4xl lg:text-4xl xl:text-5xl mb-4 leading-tight [word-spacing:0.2em]">
              BUILT FOR THE <br />
              <span className="text-accent italic underline decoration-white/10 underline-offset-8">THRILL</span> OF CONTROL.
            </h1>
            <p className="text-muted-foreground text-sm sm:text-base md:text-lg mb-6 max-w-xl leading-relaxed [word-spacing:0.1em]">
              Premium RC vehicles, crawlers, boats, construction machines and performance upgrades for the ultimate enthusiast.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link to="/collections/all-rc-models" className="btn-primary px-6 py-3 flex items-center justify-center gap-2">
                <span className="skew-x-[10deg]">Shop RC Models</span>
              </Link>
              <Link to="/collections/crawlers" className="btn-secondary px-6 py-3 flex items-center justify-center gap-2">
                <span className="skew-x-[10deg]">Explore Crawlers</span>
              </Link>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Bottom Gradient */}
      <div className="absolute bottom-0 left-0 w-full h-32 bg-gradient-to-t from-background to-transparent z-10"></div>
    </section>
  );
};

import { motion } from 'framer-motion';

export const Hero = () => {
  return (
    <section className="relative min-h-[600px] md:h-screen flex items-center justify-center overflow-hidden pt-20 md:pt-24 pb-12">
      {/* Background Image with Parallax */}
      <motion.div 
        className="absolute inset-0 z-0"
        initial={{ scale: 1.1 }}
        animate={{ scale: 1 }}
        transition={{ duration: 1.5, ease: "easeOut" }}
      >
        <img 
          src="/src/assets/images/hero_rc_car_cinematic_1790434394611.jpg" 
          alt="Premium RC Rock Crawler" 
          className="w-full h-full object-cover brightness-[0.4]"
          referrerPolicy="no-referrer"
        />
      </motion.div>

      {/* Overlay Content */}
      <div className="container relative z-10 px-4 md:px-6">
        <div className="max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
          >
            <span className="text-accent font-mono text-xs md:text-sm font-bold uppercase tracking-[0.3em] block mb-3 [word-spacing:0.2em]">
              Performance Engineering
            </span>
            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl mb-5 leading-tight [word-spacing:0.25em]">
              BUILT FOR THE <br />
              <span className="text-accent italic underline decoration-white/10 underline-offset-8">THRILL</span> OF CONTROL.
            </h1>
            <p className="text-muted-foreground text-sm sm:text-base md:text-lg mb-8 max-w-2xl leading-relaxed [word-spacing:0.12em]">
              Premium RC vehicles, crawlers, boats, construction machines and performance upgrades for the ultimate enthusiast.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <a href="/collections/all-rc-models" className="btn-primary flex items-center justify-center gap-2">
                <span className="skew-x-[10deg]">Shop RC Models</span>
              </a>
              <a href="/collections/crawlers" className="btn-secondary flex items-center justify-center gap-2">
                <span className="skew-x-[10deg]">Explore Crawlers</span>
              </a>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Bottom Gradient */}
      <div className="absolute bottom-0 left-0 w-full h-32 bg-gradient-to-t from-background to-transparent z-10"></div>
    </section>
  );
};

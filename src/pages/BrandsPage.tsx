import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, ArrowRight, ExternalLink, Award, Wrench, Zap, CheckCircle2 } from 'lucide-react';
import { motion } from 'framer-motion';

interface Brand {
  id: number;
  name: string;
  slug: string;
  description: string;
  logo: string | null;
}

const BRAND_DETAILS: Record<string, { tag: string; specialty: string; popular: string[]; origin: string }> = {
  'rgt': {
    tag: 'Tough Crawler Engineering',
    specialty: '1:10 & 1:24 Scale Rock Crawlers & Expedition Trucks',
    popular: ['EX86190 Rescuer', 'EX86120 Desert Fox', 'EX86100 Cruiser'],
    origin: 'Authorized OEM Factory Distribution'
  },
  'mjx': {
    tag: 'High-Velocity Brushless Rigs',
    specialty: 'Hyper Go Series Bashers & Precision Drift Vehicles',
    popular: ['Hyper Go 14301 Drift', 'Hyper Go 16208 Monster Truck', 'Hyper Go 14210 Truggy'],
    origin: 'Factory Direct Performance Division'
  },
  'fms': {
    tag: 'Ultra-Detailed Scale Realism',
    specialty: 'Officially Licensed Scale Crawlers & Vintage Hardbody Trucks',
    popular: ['FCX24 K5 Blazer', 'FCX18 Land Cruiser', 'Atlas 6x6 Heavy Hauler'],
    origin: 'Licensed Scale Scale Division'
  },
  'jjrc': {
    tag: 'Enthusiast All-Rounders',
    specialty: 'Entry-to-Mid Level Stunt, Amphibious & Crawler Platforms',
    popular: ['Q121 Off-Road Buggy', 'C8801 Crawler', 'Q39 Highland Beast'],
    origin: 'Multi-Terrain Engineering Labs'
  },
  'hb-toys': {
    tag: 'Rugged Trail Crawlers',
    specialty: 'High-Articulation 4WD & 6WD Rock Traversal Chassis',
    popular: ['ZP1001 Defender', 'R1001 Land Cruiser', 'HB-DK4301 Buggy'],
    origin: 'Trail Dynamics Manufacturing'
  },
  'mnrc': {
    tag: 'Scale Military & Classic Utility',
    specialty: 'Classic Defender, Land Cruiser & Tactical 4x4 Scale Vehicles',
    popular: ['MN99S Defender', 'MN82 LC79 Pickup', 'MN78 Cherokee'],
    origin: 'Scale Precision Assembly'
  },
  'rlaarlo': {
    tag: 'Carbon & Brushless High Speed',
    specialty: 'Competition-Grade Speed Run Cars & Carbon Fiber Bashers',
    popular: ['Omni-Terminator Carbon Basher', 'AK-917 100MPH Racer', 'AM-D12 Drift'],
    origin: 'Speed Run Racing Division'
  },
  'heng-long': {
    tag: 'Authentic Military & Construction',
    specialty: '1:16 Scale All-Metal Gearbox Tanks & Hydraulic Excavators',
    popular: ['Tiger I Metal Edition', 'M1A2 Abrams Smoke & Sound', 'Heavy RC Excavator 3918'],
    origin: 'Heavy Armour Scale Works'
  },
  'jiabaile': {
    tag: 'Desert Racers & Trophy Trucks',
    specialty: 'High-Speed Desert Dune Bashers & Long-Travel Buggies',
    popular: ['Desert Trophy Pro 1:12', 'Baja King 4WD', 'Viper High-Speed Racer'],
    origin: 'Desert Circuit Engineering'
  },
  'suchiyu': {
    tag: 'Compact Brushless Power',
    specialty: '1:16 Scale 70KM/H Brushless Pocket Monsters & Bashers',
    popular: ['SCY-16101PRO Brushless', 'SCY-16102 Drift Fighter', 'SCY-16201 Buggy'],
    origin: 'Micro Power Propulsion'
  }
};

export const BrandsPage = () => {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);

  useEffect(() => {
    const fetchBrands = async () => {
      try {
        const res = await fetch('/api/brands');
        const data = await res.json();
        setBrands(data);
      } catch (err) {
        console.error('Failed to load brands:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchBrands();
  }, []);

  return (
    <div className="pt-32 pb-24 min-h-screen">
      <div className="container px-4 md:px-6">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground mb-6 [word-spacing:0.15em]">
          <Link to="/" className="hover:text-white transition-colors">Home</Link>
          <span>/</span>
          <span className="text-white">Authorized Brands</span>
        </div>

        {/* Header */}
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-accent font-mono text-xs font-bold uppercase tracking-[0.3em] [word-spacing:0.2em]">
              Factory Authorized Partners
            </span>
            <span className="bg-emerald-500/20 text-emerald-400 text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
              100% Genuine Certified
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl mb-3 leading-tight [word-spacing:0.25em]">
            AUTHORIZED RC MANUFACTURERS
          </h1>
          <p className="text-muted-foreground text-sm sm:text-base md:text-lg max-w-3xl leading-relaxed italic [word-spacing:0.12em]">
            RC MEGA is an official, factory-authorized partner and distributor for the world’s leading RC brands. Every machine carries full factory warranty support, genuine spare parts availability, and technical pit crew backing.
          </p>
        </div>

        {/* Authenticity Guarantee Banner */}
        <div className="p-6 md:p-8 bg-[#0a0a0a] border border-white/10 rounded-sm mb-16 relative overflow-hidden">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative z-10">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-sm bg-accent/10 border border-accent/20 flex items-center justify-center text-accent shrink-0">
                <ShieldCheck size={24} />
              </div>
              <div>
                <h4 className="text-sm font-bold uppercase tracking-wider mb-1 [word-spacing:0.15em]">Official Manufacturer Warranty</h4>
                <p className="text-xs text-muted-foreground leading-relaxed [word-spacing:0.1em]">All models include verifiable factory serial numbers and manufacturer electronics coverage.</p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-sm bg-accent/10 border border-accent/20 flex items-center justify-center text-accent shrink-0">
                <Wrench size={24} />
              </div>
              <div>
                <h4 className="text-sm font-bold uppercase tracking-wider mb-1 [word-spacing:0.15em]">Guaranteed OEM Spare Parts</h4>
                <p className="text-xs text-muted-foreground leading-relaxed [word-spacing:0.1em]">Direct access to replacement differential gears, motors, ESCs, arms, and hardware kits.</p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-sm bg-accent/10 border border-accent/20 flex items-center justify-center text-accent shrink-0">
                <Zap size={24} />
              </div>
              <div>
                <h4 className="text-sm font-bold uppercase tracking-wider mb-1 [word-spacing:0.15em]">Pre-Delivery Calibration</h4>
                <p className="text-xs text-muted-foreground leading-relaxed [word-spacing:0.1em]">Each RTR machine undergoes drivetrain inspection and radio binding verification prior to dispatch.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Brands Grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-64 bg-white/5 animate-pulse rounded-sm border border-white/5"></div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {brands.map((brand) => {
              const details = BRAND_DETAILS[brand.slug] || {
                tag: 'Precision RC Manufacturer',
                specialty: 'High-Performance RC Engineering & Radio Control',
                popular: ['Ready-To-Run Models', 'Upgrade Kits'],
                origin: 'Authorized OEM'
              };

              return (
                <div
                  key={brand.id}
                  className="glass-card p-6 border border-white/5 flex flex-col justify-between hover:border-accent/40 transition-all group bg-[#0a0a0a]"
                >
                  <div>
                    {/* Top Tag & Logo Symbol */}
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-[10px] font-mono font-bold text-accent uppercase tracking-widest [word-spacing:0.15em]">
                        {details.tag}
                      </span>
                      <div className="w-10 h-10 bg-white/5 border border-white/10 rounded-sm skew-x-[-10deg] flex items-center justify-center text-white font-black text-sm group-hover:bg-accent transition-colors">
                        <span className="skew-x-[10deg]">{brand.name.slice(0, 3)}</span>
                      </div>
                    </div>

                    {/* Brand Name */}
                    <h3 className="text-2xl font-black italic tracking-normal uppercase mb-2 [word-spacing:0.15em]">
                      {brand.name}
                    </h3>
                    
                    <p className="text-xs text-muted-foreground leading-relaxed mb-4 italic [word-spacing:0.1em]">
                      {brand.description}
                    </p>

                    {/* Specialty & Popular Models */}
                    <div className="space-y-2 pt-4 border-t border-white/5 mb-6 text-xs">
                      <div>
                        <span className="text-[9px] uppercase tracking-wider text-muted-foreground block font-bold [word-spacing:0.1em]">Specialization:</span>
                        <span className="text-white/90 text-xs font-medium [word-spacing:0.1em]">{details.specialty}</span>
                      </div>
                      <div>
                        <span className="text-[9px] uppercase tracking-wider text-muted-foreground block font-bold [word-spacing:0.1em]">Signature Chassis:</span>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {details.popular.map((m, idx) => (
                            <span key={idx} className="bg-white/5 border border-white/10 text-[10px] px-2 py-0.5 rounded-sm text-white/80">
                              {m}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="pt-4 border-t border-white/5">
                    <Link
                      to={`/collections/all-rc-models?brand=${brand.slug}`}
                      className="btn-primary w-full py-3 text-xs flex items-center justify-center gap-2 group-hover:shadow-lg"
                    >
                      <span className="skew-x-[10deg] flex items-center gap-2 [word-spacing:0.15em]">
                        View {brand.name} Machines <ArrowRight size={14} />
                      </span>
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

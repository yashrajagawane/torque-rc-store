import { Link } from 'react-router-dom';
import { ShieldCheck, Wrench, Award, Gauge, Users, Compass, CheckCircle2, ArrowRight } from 'lucide-react';

export const AboutPage = () => {
  const stats = [
    { label: 'Machines Dispatched', value: '18,500+' },
    { label: 'Authorized Brands', value: '10 Official' },
    { label: 'OEM Spare Parts In Stock', value: '42,000+' },
    { label: 'First-Run RTR Success', value: '99.8%' },
  ];

  const pillars = [
    {
      title: 'Factory-Authorized Direct',
      desc: 'We do not sell grey-market or unverified clones. Every machine is sourced directly from certified factories like RGT, MJX, FMS, and Rlaarlo with authentic serial numbers and manufacturer backing.',
      icon: ShieldCheck,
    },
    {
      title: 'Pre-Delivery Technical PDI',
      desc: 'Before any vehicle leaves our garage, our technicians verify radio transmitter binding, gear mesh tolerances, differential fluid levels, and suspension articulation so you can run it straight out of the box.',
      icon: Wrench,
    },
    {
      title: 'Full Lifecycle Spare Parts',
      desc: 'Breaking parts is part of aggressive RC bashing and crawling. We stock complete factory exploded-diagram replacement parts from bevel gears to brushless ESCs so your machine is never retired.',
      icon: Gauge,
    },
    {
      title: 'Certified Pit Crew Support',
      desc: 'Need advice on brushless motor KV ratings, 2S vs 3S LiPo safety, or crawler shock spring rates? Our certified RC pilots are accessible via WhatsApp and email 7 days a week.',
      icon: Users,
    },
  ];

  const testTracks = [
    {
      name: 'The Quarry Articulation Trail',
      type: 'Rock Crawling & Scale Trail',
      terrain: 'Granite boulders, river rock, steep 55-degree inclines, and timber bridges designed to test portal axle clearance and low-speed torque delivery.',
    },
    {
      name: 'Apex Speed & Jump Proving Ground',
      type: 'High-Velocity Bashing',
      terrain: 'Clay launch kickers, washboard sections, and wide-sweeping berms built to stress-test carbon chassis plates, aluminum shock towers, and brushless thermal limits.',
    },
    {
      name: 'Blacktop Drift Skidpad',
      type: 'Precision RWD & AWD Drift',
      terrain: 'Polished concrete surface with track boundary sensors for tuning gyro sensitivity, steering angle bellcranks, and throttle curve dynamics.',
    },
  ];

  return (
    <div className="pt-32 pb-24 min-h-screen">
      <div className="container px-4 md:px-6">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground mb-6 [word-spacing:0.15em]">
          <Link to="/" className="hover:text-white transition-colors">Home</Link>
          <span>/</span>
          <span className="text-white">About RC MEGA</span>
        </div>

        {/* Hero Banner */}
        <div className="mb-16">
          <span className="text-accent font-mono text-xs font-bold uppercase tracking-[0.3em] block mb-3 [word-spacing:0.2em]">
            Precision Motorsport & Hobby Engineering
          </span>
          <h1 className="text-3xl sm:text-4xl md:text-6xl mb-6 leading-tight [word-spacing:0.25em]">
            BORN FROM ADRENALINE. <br />
            BUILT FOR UNCOMPROMISING CONTROL.
          </h1>
          <p className="text-muted-foreground text-base sm:text-lg md:text-xl max-w-3xl leading-relaxed italic border-l-2 border-accent pl-6 [word-spacing:0.12em]">
            RC MEGA was established by competitive RC rock crawling champions and high-speed speed-run builders who demanded real engineering, factory parts availability, and honest enthusiast guidance in the radio control world.
          </p>
        </div>

        {/* Live Garage Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-20">
          {stats.map((stat, i) => (
            <div key={i} className="glass-card p-6 border border-white/5 bg-[#0a0a0a]">
              <div className="text-2xl sm:text-3xl md:text-4xl font-black italic mb-1 text-white [word-spacing:0.15em]">
                {stat.value}
              </div>
              <span className="text-xs uppercase font-bold text-muted-foreground tracking-wider [word-spacing:0.1em]">
                {stat.label}
              </span>
            </div>
          ))}
        </div>

        {/* Story Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center mb-24">
          <div className="space-y-6">
            <span className="text-accent font-mono text-xs font-bold uppercase tracking-[0.3em] block [word-spacing:0.2em]">
              The Mission
            </span>
            <h2 className="text-2xl sm:text-3xl md:text-4xl [word-spacing:0.25em]">
              WE DON’T SELL TOYS. WE SUPPLY HOBBY-GRADE MACHINES.
            </h2>
            <div className="space-y-4 text-muted-foreground text-sm sm:text-base leading-relaxed italic [word-spacing:0.12em]">
              <p>
                In an era where department stores sell disposable plastic toys with non-replaceable parts, RC MEGA stands for mechanical permanence. Every machine we carry is a genuine, modular, hobby-grade vehicle with proportional digital radio control, oil-filled suspension, steel driveshafts, and completely modular electronics.
              </p>
              <p>
                Whether you are traversing a remote mountain riverbed with an RGT 1:10 scale rock crawler, executing 80 km/h drift entries with an MJX Hyper Go brushless chassis, or operating full hydraulic heavy construction equipment, our team ensures your machine is calibrated to deliver peak performance from day one.
              </p>
            </div>
          </div>

          <div className="glass-card p-8 border border-white/10 bg-[#080808] relative overflow-hidden">
            <h3 className="text-xl font-bold uppercase tracking-wider mb-6 italic text-white [word-spacing:0.2em]">
              THE RC MEGA STANDARD
            </h3>
            <ul className="space-y-4 text-sm">
              {[
                'Zero grey-market units — only factory verifiable serial numbers',
                'Pre-shipping bench test of ESC throttle endpoints & steering trim',
                'Exploded parts diagrams and OEM screw kits stocked in-house',
                'Direct WhatsApp line to experienced RC mechanics',
                'Protected warranty service & rapid dispatch on warranty components'
              ].map((item, idx) => (
                <li key={idx} className="flex items-start gap-3">
                  <CheckCircle2 size={18} className="text-accent shrink-0 mt-0.5" />
                  <span className="text-white/90 italic [word-spacing:0.1em]">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* 4 Pillars Grid */}
        <div className="mb-24">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <span className="text-accent font-mono text-xs font-bold uppercase tracking-[0.3em] block mb-2 [word-spacing:0.2em]">
              Quality Architecture
            </span>
            <h2 className="text-2xl sm:text-3xl md:text-4xl [word-spacing:0.25em]">OUR FOUR GARAGE PILLARS</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {pillars.map((pillar, idx) => {
              const Icon = pillar.icon;
              return (
                <div key={idx} className="glass-card p-8 border border-white/5 bg-[#0a0a0a]">
                  <div className="w-12 h-12 rounded-sm bg-accent/10 border border-accent/20 flex items-center justify-center text-accent mb-6">
                    <Icon size={24} />
                  </div>
                  <h3 className="text-lg font-bold uppercase italic tracking-wider mb-3 [word-spacing:0.18em]">
                    {pillar.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed italic [word-spacing:0.1em]">
                    {pillar.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Proving Grounds */}
        <div className="mb-24">
          <div className="mb-12">
            <span className="text-accent font-mono text-xs font-bold uppercase tracking-[0.3em] block mb-2 [word-spacing:0.2em]">
              Field Verification
            </span>
            <h2 className="text-2xl sm:text-3xl md:text-4xl mb-3 [word-spacing:0.25em]">THE PROVING GROUNDS</h2>
            <p className="text-muted-foreground text-sm sm:text-base max-w-2xl italic [word-spacing:0.12em]">
              Before a model is inducted into our showroom catalog, it is subjected to 40+ hours of endurance testing on our purpose-built terrain circuits.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {testTracks.map((track, i) => (
              <div key={i} className="p-6 bg-white/[0.02] border border-white/5 rounded-sm flex flex-col justify-between">
                <div>
                  <span className="text-[10px] font-mono text-accent uppercase tracking-widest block mb-2 [word-spacing:0.15em]">
                    {track.type}
                  </span>
                  <h4 className="text-base font-bold uppercase italic tracking-wider mb-3 [word-spacing:0.18em]">
                    {track.name}
                  </h4>
                  <p className="text-xs text-muted-foreground leading-relaxed italic [word-spacing:0.1em]">
                    {track.terrain}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Call to Action Banner */}
        <div className="p-10 md:p-14 bg-accent text-white rounded-sm text-center relative overflow-hidden">
          <div className="max-w-2xl mx-auto relative z-10">
            <h2 className="text-2xl sm:text-3xl md:text-4xl mb-4 italic [word-spacing:0.25em]">
              READY TO BUILD YOUR GARAGE?
            </h2>
            <p className="text-white/90 text-sm sm:text-base md:text-lg mb-8 italic [word-spacing:0.12em]">
              Explore our verified Ready-to-Run machines or consult directly with our pit crew for personalized setup recommendations.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link to="/collections/all-rc-models" className="bg-black text-white text-xs font-black uppercase tracking-wider italic px-8 py-4 rounded-sm skew-x-[-10deg] hover:bg-white hover:text-black transition-all [word-spacing:0.15em]">
                <span className="skew-x-[10deg] block">Explore All Models</span>
              </Link>
              <Link to="/contact" className="border-2 border-white text-white text-xs font-black uppercase tracking-wider italic px-8 py-4 rounded-sm skew-x-[-10deg] hover:bg-white hover:text-black transition-all [word-spacing:0.15em]">
                <span className="skew-x-[10deg] block">Contact Pit Crew</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

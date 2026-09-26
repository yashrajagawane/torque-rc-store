import { useState } from 'react';
import { User, Shield, Wrench, Package, Heart, LogOut, ChevronRight, Gauge, Cpu } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCartStore } from '../store/cartStore';

export const AccountDashboardPage = () => {
  const [activeTab, setActiveTab] = useState<'overview' | 'orders' | 'fleet'>('overview');
  const cartItems = useCartStore((state) => state.items);

  const mockOrders = [
    {
      id: 'ORD-98214',
      date: 'Sep 24, 2026',
      total: '$429.00',
      status: 'In Transit',
      items: 'RGT EX86190 Rescuer 1:10 Crawler'
    },
    {
      id: 'ORD-97542',
      date: 'Sep 12, 2026',
      total: '$189.50',
      status: 'Delivered',
      items: 'MJX Hyper Go 14301 Drift RTR + LiPo Battery'
    }
  ];

  const fleet = [
    {
      name: 'RGT EX86190 Rescuer',
      scale: '1:10 SCALE',
      status: 'Active Field Unit',
      topSpeed: '32 KM/H',
      battery: '3S 5200MAH'
    },
    {
      name: 'MJX Hyper Go 14301',
      scale: '1:14 SCALE',
      status: 'Tuned For Drift',
      topSpeed: '45 KM/H',
      battery: '2S 2000MAH'
    }
  ];

  return (
    <div className="pt-32 pb-24 min-h-screen">
      <div className="container px-4 md:px-6 max-w-6xl">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground mb-6 [word-spacing:0.15em]">
          <Link to="/" className="hover:text-white transition-colors">Home</Link>
          <span>/</span>
          <span className="text-white">Garage Dashboard</span>
        </div>

        {/* Dashboard Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-8 border-b border-white/10 mb-10">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-accent font-mono text-xs font-bold uppercase tracking-[0.3em] [word-spacing:0.2em]">
                Telemetry & Garage Control
              </span>
              <span className="bg-emerald-500/20 text-emerald-400 text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                Online
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl md:text-4xl [word-spacing:0.25em]">
              PILOT GARAGE DASHBOARD
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/collections/all-rc-models"
              className="btn-primary text-xs py-3 px-5"
            >
              <span className="skew-x-[10deg] flex items-center gap-2 [word-spacing:0.15em]">
                Browse Showroom
              </span>
            </Link>
          </div>
        </div>

        {/* Metric Cards Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          <div className="glass-card p-5 border border-white/5">
            <div className="flex items-center justify-between mb-3 text-muted-foreground">
              <span className="text-[10px] font-bold uppercase tracking-widest [word-spacing:0.15em]">Fleet Units</span>
              <Gauge size={18} className="text-accent" />
            </div>
            <div className="text-2xl md:text-3xl font-black italic tracking-normal [word-spacing:0.2em]">02</div>
            <span className="text-[10px] text-muted-foreground [word-spacing:0.1em]">Registered machines</span>
          </div>

          <div className="glass-card p-5 border border-white/5">
            <div className="flex items-center justify-between mb-3 text-muted-foreground">
              <span className="text-[10px] font-bold uppercase tracking-widest [word-spacing:0.15em]">Pit Stop Orders</span>
              <Package size={18} className="text-accent" />
            </div>
            <div className="text-2xl md:text-3xl font-black italic tracking-normal [word-spacing:0.2em]">02</div>
            <span className="text-[10px] text-muted-foreground [word-spacing:0.1em]">1 shipment in transit</span>
          </div>

          <div className="glass-card p-5 border border-white/5">
            <div className="flex items-center justify-between mb-3 text-muted-foreground">
              <span className="text-[10px] font-bold uppercase tracking-widest [word-spacing:0.15em]">Cart Garage</span>
              <Wrench size={18} className="text-accent" />
            </div>
            <div className="text-2xl md:text-3xl font-black italic tracking-normal [word-spacing:0.2em]">{cartItems.length}</div>
            <span className="text-[10px] text-muted-foreground [word-spacing:0.1em]">Items ready for checkout</span>
          </div>

          <div className="glass-card p-5 border border-white/5">
            <div className="flex items-center justify-between mb-3 text-muted-foreground">
              <span className="text-[10px] font-bold uppercase tracking-widest [word-spacing:0.15em]">Pilot Tier</span>
              <Shield size={18} className="text-accent" />
            </div>
            <div className="text-2xl md:text-3xl font-black italic tracking-normal [word-spacing:0.2em]">PRO</div>
            <span className="text-[10px] text-muted-foreground [word-spacing:0.1em]">Enthusiast member</span>
          </div>
        </div>

        {/* Tabs & Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Column */}
          <div className="lg:col-span-2 space-y-8">
            {/* Active Fleet */}
            <div className="glass-card p-6 border border-white/5">
              <div className="flex items-center justify-between pb-4 border-b border-white/5 mb-6">
                <div>
                  <h3 className="text-base sm:text-lg mb-1 italic tracking-normal [word-spacing:0.2em]">
                    CURRENT FLEET VEHICLES
                  </h3>
                  <p className="text-xs text-muted-foreground [word-spacing:0.12em]">
                    Vehicles mapped to your garage telemetry
                  </p>
                </div>
                <Link
                  to="/collections/all-rc-models"
                  className="text-xs font-bold text-accent hover:underline [word-spacing:0.15em]"
                >
                  + Add Machine
                </Link>
              </div>

              <div className="space-y-4">
                {fleet.map((vehicle, idx) => (
                  <div
                    key={idx}
                    className="p-4 bg-white/[0.02] border border-white/5 rounded-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-bold text-accent uppercase tracking-wider [word-spacing:0.15em]">
                          {vehicle.scale}
                        </span>
                        <span className="text-white/20">•</span>
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider [word-spacing:0.1em]">
                          {vehicle.status}
                        </span>
                      </div>
                      <h4 className="text-sm font-bold uppercase tracking-normal italic [word-spacing:0.18em]">
                        {vehicle.name}
                      </h4>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <div className="text-right">
                        <div className="text-muted-foreground text-[10px] uppercase tracking-wider [word-spacing:0.1em]">Top Speed</div>
                        <div className="font-bold text-white [word-spacing:0.1em]">{vehicle.topSpeed}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-muted-foreground text-[10px] uppercase tracking-wider [word-spacing:0.1em]">Battery Pack</div>
                        <div className="font-bold text-accent [word-spacing:0.1em]">{vehicle.battery}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Orders Section */}
            <div className="glass-card p-6 border border-white/5">
              <div className="flex items-center justify-between pb-4 border-b border-white/5 mb-6">
                <div>
                  <h3 className="text-base sm:text-lg mb-1 italic tracking-normal [word-spacing:0.2em]">
                    RECENT DISPATCHES
                  </h3>
                  <p className="text-xs text-muted-foreground [word-spacing:0.12em]">
                    Order fulfillment and delivery tracking
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                {mockOrders.map((ord) => (
                  <div
                    key={ord.id}
                    className="p-4 bg-white/[0.02] border border-white/5 rounded-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-xs font-bold text-white [word-spacing:0.1em]">{ord.id}</span>
                        <span className="text-white/20">•</span>
                        <span className="text-xs text-muted-foreground [word-spacing:0.1em]">{ord.date}</span>
                      </div>
                      <p className="text-xs text-muted-foreground italic [word-spacing:0.12em]">{ord.items}</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="font-bold text-sm [word-spacing:0.1em]">{ord.total}</div>
                        <span className="text-[10px] font-bold text-accent uppercase tracking-wider [word-spacing:0.1em]">{ord.status}</span>
                      </div>
                      <ChevronRight size={16} className="text-muted-foreground" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Sidebar Info */}
          <div className="space-y-6">
            <div className="glass-card p-6 border border-white/5">
              <div className="flex items-center gap-4 pb-6 border-b border-white/5 mb-6">
                <div className="w-14 h-14 bg-white/5 rounded-sm skew-x-[-10deg] flex items-center justify-center border border-white/10 text-accent font-black text-xl">
                  <span className="skew-x-[10deg]">RC</span>
                </div>
                <div>
                  <h4 className="text-base font-bold italic tracking-normal uppercase [word-spacing:0.2em]">
                    Pilot agawaneyash
                  </h4>
                  <p className="text-xs text-muted-foreground [word-spacing:0.1em]">
                    agawaneyash865@gmail.com
                  </p>
                </div>
              </div>

              <div className="space-y-3 text-xs">
                <div className="flex justify-between py-2 border-b border-white/5">
                  <span className="text-muted-foreground [word-spacing:0.1em]">Garage Tier</span>
                  <span className="font-bold text-accent [word-spacing:0.1em]">Pro Mechanic</span>
                </div>
                <div className="flex justify-between py-2 border-b border-white/5">
                  <span className="text-muted-foreground [word-spacing:0.1em]">Shipping Region</span>
                  <span className="font-bold [word-spacing:0.1em]">Asia Southeast (Global)</span>
                </div>
                <div className="flex justify-between py-2 border-b border-white/5">
                  <span className="text-muted-foreground [word-spacing:0.1em]">Warranty Cover</span>
                  <span className="font-bold text-emerald-400 [word-spacing:0.1em]">12 Months Active</span>
                </div>
              </div>

              <div className="pt-6">
                <button
                  onClick={() => alert('Account settings saved.')}
                  className="w-full btn-secondary text-xs py-3"
                >
                  <span className="skew-x-[10deg] [word-spacing:0.15em]">Edit Pilot Profile</span>
                </button>
              </div>
            </div>

            <div className="glass-card p-6 border border-accent/20 bg-accent/5">
              <div className="flex items-center gap-2 text-accent font-bold text-xs uppercase tracking-wider mb-2 [word-spacing:0.15em]">
                <Cpu size={16} /> Need Tuning Advice?
              </div>
              <p className="text-xs text-muted-foreground mb-4 leading-relaxed [word-spacing:0.12em]">
                Our certified RC specialists are available on WhatsApp for setup tuning, brushless ESC pairing, and crawler gearing.
              </p>
              <a
                href="https://wa.me/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center w-full bg-accent text-white font-black text-xs uppercase tracking-wider py-3 rounded-sm skew-x-[-10deg] hover:bg-white hover:text-black transition-colors"
              >
                <span className="skew-x-[10deg] [word-spacing:0.15em]">Contact Pit Crew</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

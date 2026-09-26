import { Instagram, Youtube, Facebook, Mail, Phone, MapPin } from 'lucide-react';

export const Footer = () => {
  return (
    <footer className="bg-[#050505] border-t border-white/5 pt-16 pb-8">
      <div className="container mx-auto px-4 md:px-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 mb-16">
        {/* Brand Section */}
        <div>
          <a href="/" className="flex items-center gap-2 mb-6">
            <div className="w-8 h-8 bg-primary flex items-center justify-center rounded-sm skew-x-[-10deg]">
              <span className="text-white font-black text-lg skew-x-[10deg]">RM</span>
            </div>
            <span className="text-lg font-black tracking-normal text-white uppercase italic [word-spacing:0.15em]">
              RC<span className="text-accent">MEGA</span>
            </span>
          </a>
          <p className="text-muted-foreground text-sm leading-relaxed mb-6 max-w-xs [word-spacing:0.1em]">
            The ultimate destination for premium RC hobbyists. From high-speed bashers to technical crawlers, we fuel your passion for control.
          </p>
          <div className="flex items-center gap-4">
            <a href="#" className="w-10 h-10 border border-white/10 flex items-center justify-center rounded-sm hover:bg-white hover:text-black transition-all">
              <Instagram size={18} />
            </a>
            <a href="#" className="w-10 h-10 border border-white/10 flex items-center justify-center rounded-sm hover:bg-white hover:text-black transition-all">
              <Youtube size={18} />
            </a>
            <a href="#" className="w-10 h-10 border border-white/10 flex items-center justify-center rounded-sm hover:bg-white hover:text-black transition-all">
              <Facebook size={18} />
            </a>
          </div>
        </div>

        {/* Quick Links */}
        <div>
          <h4 className="text-white font-bold uppercase tracking-widest text-sm mb-6">Shop Collections</h4>
          <ul className="space-y-4">
            <li><a href="/collections/all-rc-models" className="text-muted-foreground hover:text-accent text-sm transition-colors uppercase tracking-wider">All RC Models</a></li>
            <li><a href="/collections/crawlers" className="text-muted-foreground hover:text-accent text-sm transition-colors uppercase tracking-wider">Rock Crawlers</a></li>
            <li><a href="/collections/bashers" className="text-muted-foreground hover:text-accent text-sm transition-colors uppercase tracking-wider">High-Speed Bashers</a></li>
            <li><a href="/collections/drift" className="text-muted-foreground hover:text-accent text-sm transition-colors uppercase tracking-wider">Drift Machines</a></li>
            <li><a href="/collections/construction" className="text-muted-foreground hover:text-accent text-sm transition-colors uppercase tracking-wider">Construction Gear</a></li>
          </ul>
        </div>

        {/* Support */}
        <div>
          <h4 className="text-white font-bold uppercase tracking-widest text-sm mb-6">Support & Service</h4>
          <ul className="space-y-4">
            <li><a href="/contact" className="text-muted-foreground hover:text-accent text-sm transition-colors uppercase tracking-wider">Contact Us</a></li>
            <li><a href="/shipping" className="text-muted-foreground hover:text-accent text-sm transition-colors uppercase tracking-wider">Shipping Policy</a></li>
            <li><a href="/returns" className="text-muted-foreground hover:text-accent text-sm transition-colors uppercase tracking-wider">Returns & Warranty</a></li>
            <li><a href="/faq" className="text-muted-foreground hover:text-accent text-sm transition-colors uppercase tracking-wider">Help & FAQ</a></li>
            <li><a href="/about" className="text-muted-foreground hover:text-accent text-sm transition-colors uppercase tracking-wider">Our Story</a></li>
          </ul>
        </div>

        {/* Contact Info */}
        <div>
          <h4 className="text-white font-bold uppercase tracking-widest text-sm mb-6">Get in Touch</h4>
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <Mail size={18} className="text-accent mt-0.5" />
              <p className="text-muted-foreground text-sm">support@rcmega.com</p>
            </div>
            <div className="flex items-start gap-3">
              <Phone size={18} className="text-accent mt-0.5" />
              <p className="text-muted-foreground text-sm">+91 98765 43210</p>
            </div>
            <div className="flex items-start gap-3">
              <MapPin size={18} className="text-accent mt-0.5" />
              <p className="text-muted-foreground text-sm">Techno Park, Sector 62<br />Gurugram, HR 122002</p>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 md:px-6 pt-8 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-4">
        <p className="text-muted-foreground text-[10px] uppercase tracking-[0.2em]">
          © 2026 RC MEGA • PERFORMANCE RC HOBBY STORE • ALL RIGHTS RESERVED
        </p>
        <div className="flex items-center gap-6">
          <span className="text-muted-foreground text-[10px] uppercase tracking-[0.2em] cursor-pointer hover:text-white transition-colors">Privacy Policy</span>
          <span className="text-muted-foreground text-[10px] uppercase tracking-[0.2em] cursor-pointer hover:text-white transition-colors">Terms of Service</span>
        </div>
      </div>
    </footer>
  );
};

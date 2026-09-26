import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, Phone, Mail, MapPin, Clock, Send, CheckCircle2, ChevronDown, Wrench, Shield } from 'lucide-react';
import { cn } from '../lib/utils';

export const ContactPage = () => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    inquiryType: 'Technical Advice',
    model: '',
    message: ''
  });
  const [submitted, setSubmitted] = useState(false);
  const [ticketId, setTicketId] = useState('');
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.email || !formData.message) return;
    
    // Generate simulated ticket id
    const randomTicket = `RCM-${Math.floor(100000 + Math.random() * 900000)}`;
    setTicketId(randomTicket);
    setSubmitted(true);
  };

  const faqs = [
    {
      q: 'How fast do you dispatch orders, and how is shipping handled?',
      a: 'All in-stock RTR models and spare parts are bench-tested and dispatched within 24 hours. We use tracked expedited couriers with reinforced shock-absorbent packaging to ensure fragile transmitter antennas and body shells arrive in mint condition.'
    },
    {
      q: 'Can I order directly via WhatsApp or phone?',
      a: 'Yes! If you prefer personal assistance or want our mechanics to bundle the exact LiPo battery, charger, and spare pinion gears suited to your machine, tap the WhatsApp button to chat with our live pit crew desk.'
    },
    {
      q: 'How does your manufacturer warranty service work?',
      a: 'Every authorized machine includes manufacturer warranty coverage against factory defects in electronics (ESC, receiver, brushless motor, steering servo). If a component fails due to an OEM defect, our workshop provides direct replacement parts or warranty servicing.'
    },
    {
      q: 'Do you carry genuine spare parts for discontinued or older models?',
      a: 'Yes, we stock comprehensive exploded diagram parts inventories for all major brands we distribute. If a part is temporarily out of stock, we can order direct factory replacement sprues on your behalf.'
    },
    {
      q: 'What is your recommendation for LiPo battery safety and charging?',
      a: 'Always charge LiPo batteries in a fire-retardant LiPo safe bag on balance charge mode. Never leave batteries unattended while charging, and always put packs in "Storage Voltage" (3.80V–3.85V per cell) if not running for more than 48 hours.'
    }
  ];

  return (
    <div className="pt-32 pb-24 min-h-screen">
      <div className="container px-4 md:px-6">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground mb-6 [word-spacing:0.15em]">
          <Link to="/" className="hover:text-white transition-colors">Home</Link>
          <span>/</span>
          <span className="text-white">Contact & Pit Crew</span>
        </div>

        {/* Header */}
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-accent font-mono text-xs font-bold uppercase tracking-[0.3em] [word-spacing:0.2em]">
              Showroom & Pit Crew Support
            </span>
            <span className="bg-emerald-500/20 text-emerald-400 text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
              Mechanics Live Now
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl mb-3 leading-tight [word-spacing:0.25em]">
            CONNECT WITH THE PIT CREW
          </h1>
          <p className="text-muted-foreground text-sm sm:text-base md:text-lg max-w-3xl leading-relaxed italic [word-spacing:0.12em]">
            Need help selecting the perfect rock crawler, tuning your brushless motor timing, or tracking an in-transit machine? Our master mechanics and customer support team are at your service.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12 mb-20">
          {/* Contact Information & Channels */}
          <div className="space-y-6">
            {/* WhatsApp Priority Card */}
            <div className="glass-card p-6 border border-emerald-500/30 bg-emerald-950/10 rounded-sm">
              <div className="flex items-center gap-3 text-emerald-400 font-bold text-xs uppercase tracking-wider mb-2 [word-spacing:0.15em]">
                <MessageSquare size={18} /> Instant WhatsApp Desk
              </div>
              <p className="text-xs text-muted-foreground mb-4 leading-relaxed italic [word-spacing:0.1em]">
                For instant machine compatibility checks, video diagnosis of chassis issues, or fast direct ordering.
              </p>
              <a
                href="https://wa.me/"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-black text-xs uppercase tracking-wider py-3.5 px-4 rounded-sm flex items-center justify-center gap-2 transition-colors [word-spacing:0.15em]"
              >
                <MessageSquare size={16} /> Chat on WhatsApp Live
              </a>
            </div>

            {/* Direct Details */}
            <div className="glass-card p-6 border border-white/5 space-y-5 bg-[#0a0a0a]">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-sm bg-white/5 flex items-center justify-center text-accent shrink-0">
                  <Phone size={18} />
                </div>
                <div>
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block [word-spacing:0.1em]">
                    Helpline & Orders
                  </span>
                  <a href="tel:+18005557263" className="text-sm font-bold hover:text-accent transition-colors [word-spacing:0.1em]">
                    +1 (800) 555-RCME (7263)
                  </a>
                  <p className="text-[10px] text-muted-foreground [word-spacing:0.1em]">Toll-free direct customer desk</p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-sm bg-white/5 flex items-center justify-center text-accent shrink-0">
                  <Mail size={18} />
                </div>
                <div>
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block [word-spacing:0.1em]">
                    Technical Pit Desk
                  </span>
                  <a href="mailto:pitcrew@rcmega.com" className="text-sm font-bold hover:text-accent transition-colors [word-spacing:0.1em]">
                    pitcrew@rcmega.com
                  </a>
                  <p className="text-[10px] text-muted-foreground [word-spacing:0.1em]">Inquiries answered within 4 hours</p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-sm bg-white/5 flex items-center justify-center text-accent shrink-0">
                  <MapPin size={18} />
                </div>
                <div>
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block [word-spacing:0.1em]">
                    Showroom & Workshop
                  </span>
                  <p className="text-xs font-bold text-white [word-spacing:0.1em]">
                    RC MEGA Performance Circuit & Garage
                  </p>
                  <p className="text-[10px] text-muted-foreground [word-spacing:0.1em]">
                    Sector 4 Motorsports Complex, High-Tech Industrial Park
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-sm bg-white/5 flex items-center justify-center text-accent shrink-0">
                  <Clock size={18} />
                </div>
                <div>
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block [word-spacing:0.1em]">
                    Operational Hours
                  </span>
                  <p className="text-xs font-bold text-white [word-spacing:0.1em]">
                    Mon – Sat: 9:00 AM – 8:00 PM
                  </p>
                  <p className="text-[10px] text-muted-foreground [word-spacing:0.1em]">
                    Sunday Track Sessions: 10:00 AM – 5:00 PM
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Inquiry Form */}
          <div className="lg:col-span-2">
            <div className="glass-card p-6 md:p-8 border border-white/5 bg-[#0a0a0a]">
              {submitted ? (
                <div className="py-12 text-center space-y-4">
                  <div className="w-16 h-16 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 size={36} />
                  </div>
                  <h3 className="text-2xl font-bold uppercase italic [word-spacing:0.2em]">
                    DISPATCH TRANSMISSION RECEIVED
                  </h3>
                  <p className="text-muted-foreground text-sm max-w-md mx-auto italic [word-spacing:0.12em]">
                    Thank you, <span className="text-white font-bold">{formData.name}</span>. Your inquiry ticket <span className="text-accent font-mono font-bold">{ticketId}</span> has been logged into our technician queue.
                  </p>
                  <p className="text-xs text-muted-foreground italic [word-spacing:0.1em]">
                    A certified pit crew specialist will reply to <span className="text-white">{formData.email}</span> shortly.
                  </p>
                  <div className="pt-6">
                    <button
                      onClick={() => {
                        setSubmitted(false);
                        setFormData({
                          name: '',
                          email: '',
                          phone: '',
                          inquiryType: 'Technical Advice',
                          model: '',
                          message: ''
                        });
                      }}
                      className="btn-secondary text-xs py-3 px-6"
                    >
                      <span className="skew-x-[10deg] [word-spacing:0.15em]">Submit Another Inquiry</span>
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div>
                    <h3 className="text-xl font-bold uppercase italic tracking-wider mb-1 [word-spacing:0.18em]">
                      TRANSMIT YOUR INQUIRY
                    </h3>
                    <p className="text-xs text-muted-foreground italic [word-spacing:0.1em]">
                      Fill out the specifications below and our technicians will assist you.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block mb-2 [word-spacing:0.1em]">
                        Your Name *
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="e.g. Alex Henderson"
                        className="w-full bg-[#111] border border-white/10 rounded-sm py-3 px-4 text-xs text-white focus:outline-none focus:border-accent"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block mb-2 [word-spacing:0.1em]">
                        Email Address *
                      </label>
                      <input
                        type="email"
                        required
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        placeholder="e.g. alex@example.com"
                        className="w-full bg-[#111] border border-white/10 rounded-sm py-3 px-4 text-xs text-white focus:outline-none focus:border-accent"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block mb-2 [word-spacing:0.1em]">
                        Phone / WhatsApp (Optional)
                      </label>
                      <input
                        type="tel"
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        placeholder="+1 555-0192"
                        className="w-full bg-[#111] border border-white/10 rounded-sm py-3 px-4 text-xs text-white focus:outline-none focus:border-accent"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block mb-2 [word-spacing:0.1em]">
                        Inquiry Category
                      </label>
                      <select
                        value={formData.inquiryType}
                        onChange={(e) => setFormData({ ...formData, inquiryType: e.target.value })}
                        className="w-full bg-[#111] border border-white/10 rounded-sm py-3 px-4 text-xs text-white focus:outline-none focus:border-accent"
                      >
                        <option value="Technical Advice">Pre-Purchase Technical Advice</option>
                        <option value="Order Tracking">Order Fulfillment & Tracking</option>
                        <option value="Brushless Upgrade">Brushless & Battery Upgrade Consultation</option>
                        <option value="Warranty / Parts">Warranty & Spare Parts Request</option>
                        <option value="Wholesale">Wholesale / Club Bulk Inquiries</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block mb-2 [word-spacing:0.1em]">
                      RC Model / Vehicle Name (Optional)
                    </label>
                    <input
                      type="text"
                      value={formData.model}
                      onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                      placeholder="e.g. RGT EX86190 Rescuer or MJX 14301"
                      className="w-full bg-[#111] border border-white/10 rounded-sm py-3 px-4 text-xs text-white focus:outline-none focus:border-accent"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block mb-2 [word-spacing:0.1em]">
                      Message / Setup Details *
                    </label>
                    <textarea
                      required
                      rows={4}
                      value={formData.message}
                      onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                      placeholder="Describe your inquiry, terrain requirements, or the specific upgrade you are looking for..."
                      className="w-full bg-[#111] border border-white/10 rounded-sm py-3 px-4 text-xs text-white focus:outline-none focus:border-accent leading-relaxed"
                    />
                  </div>

                  <button
                    type="submit"
                    className="btn-primary w-full py-4 text-xs flex items-center justify-center gap-2"
                  >
                    <span className="skew-x-[10deg] flex items-center gap-2 [word-spacing:0.15em]">
                      <Send size={16} /> Submit To Pit Crew Desk
                    </span>
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>

        {/* FAQ Accordion Section */}
        <div className="max-w-3xl mx-auto pt-12 border-t border-white/5">
          <div className="text-center mb-10">
            <span className="text-accent font-mono text-xs font-bold uppercase tracking-[0.3em] block mb-2 [word-spacing:0.2em]">
              Knowledge Base
            </span>
            <h2 className="text-2xl sm:text-3xl font-bold uppercase italic [word-spacing:0.2em]">
              FREQUENTLY ASKED QUESTIONS
            </h2>
          </div>

          <div className="space-y-4">
            {faqs.map((faq, index) => {
              const isOpen = openFaq === index;
              return (
                <div
                  key={index}
                  className="border border-white/5 rounded-sm bg-[#0a0a0a] overflow-hidden"
                >
                  <button
                    onClick={() => setOpenFaq(isOpen ? null : index)}
                    className="w-full p-5 text-left flex items-center justify-between gap-4 hover:bg-white/[0.02] transition-colors"
                  >
                    <span className="text-xs sm:text-sm font-bold uppercase tracking-wider italic text-white/90 [word-spacing:0.15em]">
                      {faq.q}
                    </span>
                    <ChevronDown
                      size={16}
                      className={cn(
                        "text-accent shrink-0 transition-transform duration-200",
                        isOpen && "rotate-180"
                      )}
                    />
                  </button>
                  {isOpen && (
                    <div className="px-5 pb-5 text-xs text-muted-foreground leading-relaxed italic border-t border-white/5 pt-3 [word-spacing:0.1em]">
                      {faq.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

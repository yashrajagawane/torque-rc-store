import { X, ShoppingBag, Trash2, Plus, Minus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCartStore } from '../../store/cartStore';
import { formatCurrency } from '../../lib/utils';

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CartDrawer = ({ isOpen, onClose }: CartDrawerProps) => {
  const { items, removeItem, updateQuantity } = useCartStore();
  const subtotal = items.reduce((acc, item) => acc + parseFloat(item.price) * item.quantity, 0);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100]"
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed top-0 right-0 h-full w-full max-w-md bg-card border-l border-white/5 z-[101] flex flex-col"
          >
            {/* Header */}
            <div className="p-6 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <ShoppingBag size={20} className="text-accent" />
                <h2 className="text-xl font-black italic tracking-tighter uppercase">Your Garage</h2>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                <X size={20} />
              </button>
            </div>

            {/* Items */}
            <div className="flex-grow overflow-y-auto p-6 space-y-6">
              {items.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center opacity-50">
                  <ShoppingBag size={48} className="mb-4" />
                  <p className="text-lg font-bold italic uppercase">Your garage is empty</p>
                  <p className="text-xs uppercase tracking-widest mt-2">Start building your collection</p>
                </div>
              ) : (
                items.map((item) => (
                  <div key={item.id} className="flex gap-4 pb-6 border-b border-white/5 last:border-0">
                    <div className="w-20 h-20 bg-white/5 rounded-sm flex-shrink-0 p-2">
                      <img src={item.thumbnail} alt={item.name} className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                    </div>
                    <div className="flex-grow">
                      <div className="flex justify-between mb-1">
                        <span className="text-[10px] font-black text-accent uppercase tracking-widest italic">{item.brandName}</span>
                        <button onClick={() => removeItem(item.id)} className="text-muted-foreground hover:text-red-500 transition-colors">
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <h4 className="text-sm font-bold uppercase tracking-tight italic mb-2">{item.name}</h4>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center bg-[#111] rounded-sm border border-white/10 h-8">
                          <button 
                            onClick={() => updateQuantity(item.id, item.quantity - 1)}
                            className="w-8 h-full flex items-center justify-center text-muted-foreground hover:text-white"
                          ><Minus size={12} /></button>
                          <span className="w-6 text-center text-xs font-bold">{item.quantity}</span>
                          <button 
                            onClick={() => updateQuantity(item.id, item.quantity + 1)}
                            className="w-8 h-full flex items-center justify-center text-muted-foreground hover:text-white"
                          ><Plus size={12} /></button>
                        </div>
                        <span className="font-black italic text-sm">{formatCurrency(parseFloat(item.price) * item.quantity)}</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            {items.length > 0 && (
              <div className="p-6 bg-[#050505] border-t border-white/5">
                <div className="flex justify-between mb-6">
                  <span className="text-xs font-black uppercase tracking-widest text-muted-foreground">Subtotal</span>
                  <span className="text-xl font-black italic tracking-tighter">{formatCurrency(subtotal)}</span>
                </div>
                <button className="btn-primary w-full py-5 flex items-center justify-center gap-3 mb-3">
                  <span className="skew-x-[10deg] flex items-center gap-2">PROCEED TO CHECKOUT</span>
                </button>
                <p className="text-[10px] text-center text-muted-foreground uppercase tracking-widest">
                  Shipping and taxes calculated at checkout
                </p>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

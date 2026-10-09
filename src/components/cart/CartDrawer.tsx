import { X, ShoppingBag, Trash2, Plus, Minus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import { useCartStore } from '../../store/cartStore';
import { formatCurrency } from '../../lib/utils';
import { useVisibleCart } from '../../cart/useVisibleCart';
import { getLegacyRecoveryNotice } from '../../cart/legacyRecoveryNotice';

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CartDrawer = ({ isOpen, onClose }: CartDrawerProps) => {
  const visibleCart = useVisibleCart();
  const { items, visibility, recovery, syncing } = visibleCart;
  const legacyRecoveryNotice = getLegacyRecoveryNotice(visibleCart);
  const { removeItem, updateQuantity, clearCart, retrySync, pendingMerge, legacyMergeKey, guestItemsOwnerId, mode } = useCartStore();
  const syncError = recovery?.syncError ?? '';
  const cartLocked = visibility === 'loading' || visibility === 'recovery' || Boolean(pendingMerge || legacyMergeKey || (mode === 'guest' && guestItemsOwnerId));
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
                <h2 className="text-lg font-black italic tracking-normal uppercase [word-spacing:0.2em]">Your Garage</h2>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                <X size={20} />
              </button>
            </div>

            {/* Items */}
            <div className="flex-grow overflow-y-auto p-6 space-y-6">
              {legacyRecoveryNotice && <div role="alert" className="p-3 border border-amber-500/30 bg-amber-500/5 text-amber-200 text-xs">
                <p className="font-bold">{legacyRecoveryNotice.title}</p>
                <p className="mt-2">{legacyRecoveryNotice.message}</p>
                <p className="mt-2">Email <a className="underline" href={`mailto:${legacyRecoveryNotice.supportEmail}`}>{legacyRecoveryNotice.supportEmail}</a> for manual recovery.</p>
              </div>}
              {recovery?.legacyMergeKey && <div role="alert" className="p-3 border border-amber-500/30 bg-amber-500/5 text-amber-200 text-xs">
                <p>This older merge has no saved request payload, so it cannot be retried safely. Its saved cart data remains preserved on this device.</p>
                <p className="mt-2">Contact RC MEGA support with recovery reference <code className="select-all break-all">{recovery.legacyMergeKey}</code>. Do not clear this browser's saved data.</p>
              </div>}
              {recovery?.pendingMergeBlocked && recovery.pendingMerge && <div role="alert" className="p-3 border border-amber-500/30 bg-amber-500/5 text-amber-200 text-xs">
                <p>This cart merge needs support recovery. Your request and items remain saved.</p>
                <p className="mt-2">Reference <code className="select-all break-all">{recovery.pendingMerge.key}</code></p>
              </div>}
              {recovery?.pendingMerge && !syncError && !recovery.pendingMergeBlocked && <p role="status" className="p-3 border border-amber-500/30 bg-amber-500/5 text-amber-200 text-xs">This cart snapshot is preserved for its original account. Sign in to that account to resume synchronization.</p>}
              {syncError && !recovery?.legacyMergeKey && !recovery?.pendingMergeBlocked && <div role="alert" className="p-3 border border-red-500/30 bg-red-500/5 text-red-300 text-xs">
                <p>{syncError}</p><button onClick={retrySync} className="mt-2 underline">Retry cart sync</button>
              </div>}
              {cartLocked && recovery && !syncError && <p role="status" className="p-3 border border-amber-500/30 bg-amber-500/5 text-amber-200 text-xs">Cart changes are paused while your saved items are being recovered.</p>}
              {syncing && <p role="status" className="text-xs text-muted-foreground">Syncing your cart…</p>}
              {items.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center opacity-50">
                  <ShoppingBag size={48} className="mb-4" />
                  <p className="text-lg font-bold italic uppercase">{visibility === 'loading' ? 'Checking your garage' : recovery || legacyRecoveryNotice ? 'Cart hidden for recovery' : visibility === 'recovery' ? 'Cart temporarily unavailable' : 'Your garage is empty'}</p>
                  <p className="text-xs uppercase tracking-widest mt-2">{visibility === 'loading' ? 'Waiting for account and cart ownership to resolve' : legacyRecoveryNotice ? 'Automatic recovery is disabled; contact support' : recovery ? 'Restore the account that owns these saved items' : visibility === 'recovery' ? 'Cart contents are hidden until ownership is confirmed' : 'Start building your collection'}</p>
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
                        <button onClick={() => removeItem(item.id)} disabled={cartLocked} className="text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <h4 className="text-sm font-bold uppercase tracking-tight italic mb-2">{item.name}</h4>
                      {item.stock !== undefined && item.stock !== null && item.quantity > item.stock && <p className="text-[10px] text-red-300 mb-2">Only {item.stock} currently available. Adjust the quantity to save your cart.</p>}
                      {item.isPublished === false && <p className="text-[10px] text-red-300 mb-2">This product is no longer available.</p>}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center bg-[#111] rounded-sm border border-white/10 h-8">
                          <button 
                            onClick={() => updateQuantity(item.id, item.quantity - 1)}
                            disabled={cartLocked}
                            className="w-8 h-full flex items-center justify-center text-muted-foreground hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                          ><Minus size={12} /></button>
                          <span className="w-6 text-center text-xs font-bold">{item.quantity}</span>
                          <button 
                            onClick={() => updateQuantity(item.id, item.quantity + 1)}
                            disabled={cartLocked || (item.stock !== undefined && item.stock !== null && item.quantity >= item.stock) || item.availability === 'OUT_OF_STOCK' || item.isPublished === false}
                            className="w-8 h-full flex items-center justify-center text-muted-foreground hover:text-white disabled:opacity-30"
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
                <button onClick={clearCart} disabled={cartLocked} className="text-[10px] text-muted-foreground hover:text-white underline mb-4 disabled:opacity-40 disabled:cursor-not-allowed">Clear cart</button>
                <div className="flex justify-between mb-6">
                  <span className="text-xs font-black uppercase tracking-widest text-muted-foreground [word-spacing:0.1em]">Subtotal</span>
                  <span className="text-lg font-black italic tracking-normal [word-spacing:0.15em]">{formatCurrency(subtotal)}</span>
                </div>
                <Link to="/checkout" onClick={onClose} className="btn-primary w-full py-5 flex items-center justify-center gap-3 mb-3">
                  <span className="skew-x-[10deg] flex items-center gap-2">PROCEED TO CHECKOUT</span>
                </Link>
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

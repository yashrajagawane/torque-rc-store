import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface CartItem {
  id: number;
  slug: string;
  name: string;
  price: string;
  thumbnail: string;
  quantity: number;
  brandName?: string;
  availability?: string;
  stock?: number | null;
  isPublished?: boolean;
}

export interface CartMergeItem {
  productId: number;
  quantity: number;
}

export interface PendingCartMerge {
  ownerId: string;
  key: string;
  items: CartMergeItem[];
}

export type CartOwnerScope = { kind: 'guest' } | { kind: 'customer'; userId: string };

export function isCartMutationLocked(state: Pick<CartStore, 'pendingMerge' | 'mode' | 'guestItemsOwnerId'>) {
  return Boolean(state.pendingMerge || ('legacyMergeKey' in state && state.legacyMergeKey) || (state.mode === 'guest' && state.guestItemsOwnerId));
}

interface CartStore {
  items: CartItem[];
  guestItems: CartItem[];
  customerCarts: Record<string, CartItem[]>;
  guestItemsOwnerId: string | null;
  pendingMerge: PendingCartMerge | null;
  pendingMergeBlocked: boolean;
  legacyMergeKey: string | null;
  legacyMergeOwner: CartOwnerScope | null;
  ownerId: string | null;
  mode: 'guest' | 'customer';
  hydrated: boolean;
  syncing: boolean;
  syncError: string;
  syncOwner: CartOwnerScope | null;
  retryVersion: number;
  addItem: (item: CartItem) => void;
  removeItem: (id: number) => void;
  updateQuantity: (id: number, quantity: number) => void;
  clearCart: () => void;
  setCustomerItems: (ownerId: string, items: CartItem[]) => void;
  beginPendingMerge: (ownerId: string, items: CartItem[]) => PendingCartMerge | null;
  completePendingMerge: (ownerId: string, key: string, items: CartItem[], guestRemainder: CartItem[]) => boolean;
  blockPendingMerge: (key: string, error: string) => void;
  restoreGuestItems: () => void;
  finishHydration: () => void;
  setSyncState: (syncing: boolean, error?: string, owner?: CartOwnerScope | null) => void;
  retrySync: () => void;
}

export type CartVisibility = 'loading' | 'guest' | 'customer' | 'recovery';
export interface CartVisibilityAuth { loading: boolean; userId: string | null }
export interface VisibleCart {
  items: CartItem[];
  visibility: CartVisibility;
  recovery: { pendingMerge: PendingCartMerge | null; pendingMergeBlocked: boolean; legacyMergeKey: string | null; syncError: string } | null;
  legacyRecovery: 'unowned' | null;
  syncing: boolean;
}

const HIDDEN_CART: CartItem[] = [];

/** Render-time ownership filter. It never changes or clears persisted cart state. */
export function selectVisibleCart(
  state: Pick<CartStore, 'items' | 'guestItems' | 'guestItemsOwnerId' | 'pendingMerge' | 'pendingMergeBlocked' | 'legacyMergeKey' | 'legacyMergeOwner' | 'syncError' | 'syncOwner' | 'syncing' | 'ownerId' | 'mode' | 'hydrated'>,
  auth: CartVisibilityAuth,
): VisibleCart {
  const hidden = (visibility: CartVisibility): VisibleCart => ({ items: HIDDEN_CART, visibility, recovery: null, legacyRecovery: null, syncing: false });
  if (!state.hydrated || auth.loading) return hidden('loading');

  const currentOwner: CartOwnerScope = auth.userId ? { kind: 'customer', userId: auth.userId } : { kind: 'guest' };
  const belongsToCurrentOwner = (owner: CartOwnerScope | null) => owner?.kind === currentOwner.kind
    && (owner.kind === 'guest' || (currentOwner.kind === 'customer' && owner.userId === currentOwner.userId));
  const ownPending = state.pendingMerge?.ownerId === auth.userId && Boolean(auth.userId) ? state.pendingMerge : null;
  const ownLegacyKey = belongsToCurrentOwner(state.legacyMergeOwner) ? state.legacyMergeKey : null;
  const ownSyncError = belongsToCurrentOwner(state.syncOwner) ? state.syncError : '';
  const recovery = ownPending || ownLegacyKey || ownSyncError
    ? { pendingMerge: ownPending, pendingMergeBlocked: Boolean(ownPending && state.pendingMergeBlocked), legacyMergeKey: ownLegacyKey, syncError: ownSyncError }
    : null;
  const syncing = state.syncing && belongsToCurrentOwner(state.syncOwner);
  const legacyRecovery = state.legacyMergeKey && !state.legacyMergeOwner ? 'unowned' : null;

  if (auth.userId) {
    if (state.legacyMergeKey) return { ...hidden('recovery'), recovery, legacyRecovery };
    if (state.ownerId === auth.userId && state.mode === 'customer') {
      return { items: state.items, visibility: 'customer', recovery, legacyRecovery, syncing };
    }
    return { ...hidden(state.pendingMerge || state.guestItemsOwnerId ? 'recovery' : 'loading'), recovery, legacyRecovery };
  }

  if (state.mode === 'guest' && state.ownerId === null && !state.pendingMerge && !state.legacyMergeKey && !state.guestItemsOwnerId) {
    return { items: state.guestItems, visibility: 'guest', recovery, legacyRecovery, syncing };
  }
  return { ...hidden(state.pendingMerge || state.legacyMergeKey || state.guestItemsOwnerId ? 'recovery' : 'loading'), recovery, legacyRecovery };
}

export function hydrateCartState(persisted: Partial<CartStore> | undefined, current: CartStore): CartStore {
  const saved = persisted ?? {};
  const legacy = saved as Partial<CartStore> & { guestMergeKey?: string | null };
  const customerCarts = { ...(saved.customerCarts ?? {}) };
  if (saved.ownerId && saved.mode === 'customer' && saved.items && !customerCarts[saved.ownerId]) {
    customerCarts[saved.ownerId] = saved.items;
  }
  return {
    ...current,
    ...saved,
    items: saved.items ?? [],
    guestItems: saved.guestItems ?? (saved.ownerId ? [] : saved.items ?? []),
    customerCarts,
    guestItemsOwnerId: saved.guestItemsOwnerId ?? null,
    pendingMerge: saved.pendingMerge ? Object.freeze({
      ...saved.pendingMerge,
      items: Object.freeze(saved.pendingMerge.items.map((item) => Object.freeze({ ...item }))),
    }) as PendingCartMerge : null,
    pendingMergeBlocked: saved.pendingMergeBlocked ?? false,
    legacyMergeKey: saved.legacyMergeKey ?? legacy.guestMergeKey ?? null,
    legacyMergeOwner: saved.legacyMergeOwner ?? null,
    syncOwner: null,
    mode: saved.mode ?? 'guest',
  } as CartStore;
}

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],
      guestItems: [],
      customerCarts: {},
      guestItemsOwnerId: null,
      pendingMerge: null,
      pendingMergeBlocked: false,
      legacyMergeKey: null,
      legacyMergeOwner: null,
      ownerId: null,
      mode: 'guest',
      hydrated: false,
      syncing: false,
      syncError: '',
      syncOwner: null,
      retryVersion: 0,
      addItem: (item) => set((state) => {
        if (isCartMutationLocked(state)) return {};
        const sourceItems = state.mode === 'guest' ? state.guestItems : state.items;
        const existingItem = sourceItems.find((entry) => entry.id === item.id);
        const items = existingItem
          ? sourceItems.map((entry) => entry.id === item.id ? { ...entry, ...item, quantity: entry.quantity + item.quantity } : entry)
          : [...sourceItems, item];
        return state.mode === 'guest'
          ? { items, guestItems: items }
          : { items, customerCarts: state.ownerId ? { ...state.customerCarts, [state.ownerId]: items } : state.customerCarts };
      }),
      removeItem: (id) => set((state) => {
        if (isCartMutationLocked(state)) return {};
        const sourceItems = state.mode === 'guest' ? state.guestItems : state.items;
        const items = sourceItems.filter((item) => item.id !== id);
        return state.mode === 'guest'
          ? { items, guestItems: items }
          : { items, customerCarts: state.ownerId ? { ...state.customerCarts, [state.ownerId]: items } : state.customerCarts };
      }),
      updateQuantity: (id, quantity) => set((state) => {
        if (isCartMutationLocked(state)) return {};
        const sourceItems = state.mode === 'guest' ? state.guestItems : state.items;
        const items = sourceItems.map((item) => item.id === id ? { ...item, quantity: Math.max(1, quantity) } : item);
        return state.mode === 'guest'
          ? { items, guestItems: items }
          : { items, customerCarts: state.ownerId ? { ...state.customerCarts, [state.ownerId]: items } : state.customerCarts };
      }),
      clearCart: () => set((state) => {
        if (isCartMutationLocked(state)) return {};
        return state.mode === 'guest'
          ? { items: [], guestItems: [] }
          : { items: [], customerCarts: state.ownerId ? { ...state.customerCarts, [state.ownerId]: [] } : state.customerCarts };
      }),
      setCustomerItems: (ownerId, items) => set((state) => {
        if (state.pendingMerge?.ownerId === ownerId) return {};
        return {
          items,
          ownerId,
          mode: 'customer',
          customerCarts: { ...state.customerCarts, [ownerId]: items },
          guestItems: state.guestItems,
        };
      }),
      beginPendingMerge: (ownerId, items) => {
        const state = get();
        if (state.legacyMergeKey) return null;
        if (state.pendingMerge) return state.pendingMerge.ownerId === ownerId ? state.pendingMerge : null;
        if (state.guestItemsOwnerId && state.guestItemsOwnerId !== ownerId) return null;
        const operation = Object.freeze({
          ownerId,
          key: crypto.randomUUID(),
          items: Object.freeze(items.map(({ id, quantity }) => Object.freeze({ productId: id, quantity }))),
        }) as PendingCartMerge;
        set({ pendingMerge: operation, pendingMergeBlocked: false, syncError: '', syncOwner: null });
        return operation;
      },
      completePendingMerge: (ownerId, key, items, guestRemainder) => {
        const state = get();
        if (state.pendingMerge?.ownerId !== ownerId || state.pendingMerge.key !== key) return false;
        set({
          items,
          ownerId,
          mode: 'customer',
          customerCarts: { ...state.customerCarts, [ownerId]: items },
          guestItems: guestRemainder,
          guestItemsOwnerId: guestRemainder.length ? ownerId : null,
          pendingMerge: null,
          pendingMergeBlocked: false,
          syncError: '',
        });
        return true;
      },
      blockPendingMerge: (key, error) => set((state) => state.pendingMerge?.key === key
        ? { pendingMergeBlocked: true, syncing: false, syncError: error, syncOwner: { kind: 'customer', userId: state.pendingMerge.ownerId } }
        : {}),
      restoreGuestItems: () => set((state) => ({
        // Switch ownership metadata only. The render selector chooses guestItems, while customerCarts retains account data.
        ownerId: null,
        mode: 'guest',
      })),
      finishHydration: () => set((state) => ({
        hydrated: true,
        guestItems: state.guestItems.length ? state.guestItems : state.ownerId ? [] : state.items,
      })),
      setSyncState: (syncing, syncError = '', owner = null) => set({
        syncing,
        syncError,
        syncOwner: (syncing || syncError) ? owner : null,
      }),
      retrySync: () => set((state) => state.pendingMergeBlocked
        ? { syncError: 'This cart merge needs manual recovery. Your saved guest items are preserved and locked to prevent duplicate merging.' }
        : { retryVersion: state.retryVersion + 1, syncError: '' }),
    }),
    {
      name: 'rc-mega-cart',
      partialize: (state) => ({
        items: state.items,
        guestItems: state.guestItems,
        customerCarts: state.customerCarts,
        guestItemsOwnerId: state.guestItemsOwnerId,
        pendingMerge: state.pendingMerge,
        pendingMergeBlocked: state.pendingMergeBlocked,
        legacyMergeKey: state.legacyMergeKey,
        legacyMergeOwner: state.legacyMergeOwner,
        ownerId: state.ownerId,
        mode: state.mode,
      }) as CartStore,
      merge: (persisted, current) => hydrateCartState(persisted as Partial<CartStore> | undefined, current),
      onRehydrateStorage: () => (state) => state?.finishHydration(),
    }
  )
);

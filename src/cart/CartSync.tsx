import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useCartStore, type CartItem, type PendingCartMerge } from '../store/cartStore';

interface ApiCartItem extends CartItem { productId: number }
interface MergeRejection { productId: number; unmergedQuantity: number; reason: string }
interface MergeResponse { items: ApiCartItem[]; rejected?: MergeRejection[] }

export class CartRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'CartRequestError';
  }
}

async function cartRequest<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { ...init, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new CartRequestError(payload.error || 'Your saved cart could not be updated.', response.status);
  return payload as T;
}

/** Retries always serialize the persisted immutable operation, never current guest state. */
export function sendPendingMerge(
  operation: PendingCartMerge,
  token: string,
  request = cartRequest<MergeResponse>,
) {
  return request('/api/cart/merge', token, {
    method: 'POST',
    headers: { 'Idempotency-Key': operation.key },
    body: JSON.stringify({ items: operation.items }),
  });
}

function fromApi(items: ApiCartItem[]): CartItem[] {
  return items.map((item) => ({ ...item, id: item.productId }));
}

function cartKey(items: CartItem[]) {
  return JSON.stringify(items.map(({ id, quantity }) => ({ productId: id, quantity })).sort((a, b) => a.productId - b.productId));
}

export function mergeFailureMessage(error: unknown) {
  if (error instanceof CartRequestError && error.status === 409) {
    return 'Cart merge conflict needs manual recovery. Your guest items and request key are saved and locked so they cannot be merged twice.';
  }
  if (error instanceof CartRequestError && error.status >= 400 && error.status < 500 && error.status !== 401 && error.status !== 429) {
    return 'This cart merge needs manual recovery. Your guest items and request key are saved and locked so they cannot be lost or merged twice.';
  }
  return error instanceof Error ? error.message : 'Could not load your saved cart. Retry to continue with the same saved merge request.';
}

export function isUnrecoverableMergeError(error: unknown) {
  return error instanceof CartRequestError
    && error.status >= 400
    && error.status < 500
    && error.status !== 401
    && error.status !== 429;
}

export function canRecoverPendingMerge(operation: PendingCartMerge | null, customerId: string | undefined) {
  return !operation || operation.ownerId === customerId;
}

export type CartSyncDecision = 'legacy-recovery' | 'other-account' | 'manual-recovery' | 'merge' | 'load';

/** Decision used before any request or UUID creation, including after hydration/repeated effects. */
export function decideCartSync(input: {
  customerId: string;
  legacyMergeKey: string | null;
  pendingMerge: PendingCartMerge | null;
  pendingMergeBlocked: boolean;
  guestItemsOwnerId: string | null;
  guestItemCount: number;
}): CartSyncDecision {
  if (input.legacyMergeKey) return 'legacy-recovery';
  const foreignOperation = input.pendingMerge && input.pendingMerge.ownerId !== input.customerId;
  const foreignGuestItems = input.guestItemsOwnerId && input.guestItemsOwnerId !== input.customerId;
  if (foreignOperation || foreignGuestItems) return 'other-account';
  if (input.pendingMergeBlocked) return 'manual-recovery';
  if (input.pendingMerge || input.guestItemCount > 0) return 'merge';
  return 'load';
}

export function legacyRecoveryMessage(key: string) {
  return `A previous cart merge has no saved request payload and cannot be retried safely. Your cart data is preserved. Contact Fly RC Hobbies support with recovery reference ${key}; do not clear this browser's saved data.`;
}

export function prepareCartSync(
  input: Omit<Parameters<typeof decideCartSync>[0], 'guestItemCount'> & { guestItems: CartItem[] },
  begin: (ownerId: string, items: CartItem[]) => PendingCartMerge | null,
) {
  const decision = decideCartSync({ ...input, guestItemCount: input.guestItems.length });
  return {
    decision,
    operation: decision === 'merge' ? begin(input.customerId, input.guestItems) : null,
  };
}

/** Keeps the existing Zustand/localStorage cart responsive while syncing signed-in carts. */
export function CartSync() {
  const { session, loading: authLoading } = useAuth();
  const accessToken = session?.access_token;
  const customerId = session?.user.id;
  const items = useCartStore((state) => state.items);
  const ownerId = useCartStore((state) => state.ownerId);
  const hydrated = useCartStore((state) => state.hydrated);
  const retryVersion = useCartStore((state) => state.retryVersion);
  const pendingMerge = useCartStore((state) => state.pendingMerge);
  const pendingMergeBlocked = useCartStore((state) => state.pendingMergeBlocked);
  const [readyOwner, setReadyOwner] = useState<string | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const lastSent = useRef('');
  const lastRetryVersion = useRef(retryVersion);

  useEffect(() => {
    if (authLoading || !hydrated) return;
    if (!accessToken || !customerId) {
      useCartStore.getState().restoreGuestItems();
      setReadyOwner(null);
      lastSent.current = '';
      return;
    }
    if (readyOwner === customerId) return;

    const state = useCartStore.getState();
    const plan = prepareCartSync({
      customerId,
      legacyMergeKey: state.legacyMergeKey,
      pendingMerge: state.pendingMerge,
      pendingMergeBlocked: state.pendingMergeBlocked,
      guestItemsOwnerId: state.guestItemsOwnerId,
      guestItems: state.guestItems,
    }, (ownerId, guestItems) => useCartStore.getState().beginPendingMerge(ownerId, guestItems));
    const decision = plan.decision;
    if (decision === 'legacy-recovery') {
      state.setSyncState(false, legacyRecoveryMessage(state.legacyMergeKey!), state.legacyMergeOwner);
      setReadyOwner(null);
      lastSent.current = '';
      return;
    }
    const foreignPendingMerge = decision === 'other-account' && Boolean(state.pendingMerge && state.pendingMerge.ownerId !== customerId);
    // Keep cross-account recovery details attached to their original owner; do not turn them into this user's status.
    // The render selector hides mismatched items synchronously; keep each persisted account cache intact.
    if (decision === 'manual-recovery') {
      state.setSyncState(false, state.syncError || 'This cart merge needs manual recovery. Your guest items remain saved and locked.', state.pendingMerge ? { kind: 'customer', userId: state.pendingMerge.ownerId } : { kind: 'customer', userId: customerId });
      return;
    }

    let active = true;
    setReadyOwner(null);
    lastSent.current = '';
    useCartStore.getState().setSyncState(true, '', { kind: 'customer', userId: customerId });
    const operation = plan.operation;
    if (decision === 'merge' && !operation) {
      useCartStore.getState().setSyncState(false, 'The saved guest cart cannot be assigned to this account. Its items are preserved and locked.', { kind: 'customer', userId: customerId });
      return;
    }

    const load = async () => {
      try {
        const response = operation
          ? await sendPendingMerge(operation, accessToken)
          : await cartRequest<MergeResponse>('/api/cart', accessToken);
        if (!active) return;
        const serverItems = fromApi(response.items || []);
        if (operation) {
          const rejections = Array.isArray(response.rejected) ? response.rejected : [];
          const latestGuestItems = useCartStore.getState().guestItems;
          const guestRemainder = operation.items.flatMap((entry) => {
            const rejected = rejections.find((candidate) => candidate.productId === entry.productId);
            const source = latestGuestItems.find((item) => item.id === entry.productId);
            return rejected && source ? [{ ...source, quantity: rejected.unmergedQuantity }] : [];
          });
          if (!useCartStore.getState().completePendingMerge(customerId, operation.key, serverItems, guestRemainder)) return;
          if (rejections.length) {
            useCartStore.getState().setSyncState(false, 'Some guest items could not be merged because they are unavailable or exceed stock. They remain saved and locked to this account.', { kind: 'customer', userId: customerId });
          } else {
            useCartStore.getState().setSyncState(false);
          }
        } else if (foreignPendingMerge) {
          useCartStore.getState().setCustomerItems(customerId, serverItems);
          useCartStore.getState().setSyncState(false);
        } else {
          useCartStore.getState().setCustomerItems(customerId, serverItems);
          useCartStore.getState().setSyncState(false);
        }
        lastSent.current = cartKey(serverItems);
        setReadyOwner(customerId);
      } catch (error) {
        if (!active) return;
        if (operation && isUnrecoverableMergeError(error)) {
          useCartStore.getState().blockPendingMerge(operation.key, mergeFailureMessage(error));
        } else {
          useCartStore.getState().setSyncState(false, mergeFailureMessage(error), operation ? { kind: 'customer', userId: operation.ownerId } : { kind: 'customer', userId: customerId });
        }
      }
    };
    void load();
    return () => { active = false; };
  }, [accessToken, authLoading, customerId, hydrated, readyOwner, retryVersion]);

  useEffect(() => {
    if (lastRetryVersion.current !== retryVersion) {
      lastRetryVersion.current = retryVersion;
      lastSent.current = '';
    }
    const state = useCartStore.getState();
    if (state.legacyMergeKey) {
      state.setSyncState(false, legacyRecoveryMessage(state.legacyMergeKey), state.legacyMergeOwner);
      return;
    }
    if (!hydrated || !accessToken || !customerId || readyOwner !== customerId || ownerId !== customerId || state.pendingMerge) return;
    const key = cartKey(items);
    if (key === lastSent.current) return;
    lastSent.current = key;
    const payload = items.map((item) => ({ productId: item.id, quantity: item.quantity }));
    queue.current = queue.current.catch(() => undefined).then(async () => {
      useCartStore.getState().setSyncState(true, '', { kind: 'customer', userId: customerId });
      try {
        const response = await cartRequest<MergeResponse>('/api/cart', accessToken, { method: 'PUT', body: JSON.stringify({ items: payload }) });
        if (useCartStore.getState().ownerId !== customerId || useCartStore.getState().pendingMerge) return;
        const serverItems = fromApi(response.items || []);
        if (cartKey(useCartStore.getState().items) === key) {
          useCartStore.getState().setCustomerItems(customerId, serverItems);
        }
        lastSent.current = cartKey(serverItems);
        useCartStore.getState().setSyncState(false);
      } catch (error) {
        useCartStore.getState().setSyncState(false, mergeFailureMessage(error), { kind: 'customer', userId: customerId });
      }
    });
  }, [accessToken, customerId, hydrated, items, ownerId, pendingMerge, readyOwner, retryVersion]);

  return null;
}

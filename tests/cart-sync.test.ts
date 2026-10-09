import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canRecoverPendingMerge, CartRequestError, isUnrecoverableMergeError, prepareCartSync, sendPendingMerge } from '../src/cart/CartSync.tsx';
import { getLegacyRecoveryNotice, LEGACY_RECOVERY_SUPPORT_EMAIL } from '../src/cart/legacyRecoveryNotice.ts';
import { hydrateCartState, selectVisibleCart, useCartStore, type CartItem, type PendingCartMerge } from '../src/store/cartStore.ts';

const customerA = '11111111-1111-4111-8111-111111111111';
const customerB = '22222222-2222-4222-8222-222222222222';
const guestItem: CartItem = { id: 7, slug: 'rc-truck', name: 'RC Truck', price: '1000', thumbnail: 'truck.png', quantity: 2 };
const serverItem: CartItem = { ...guestItem, quantity: 2 };

function resetStore(overrides: Partial<ReturnType<typeof useCartStore.getState>> = {}) {
  useCartStore.setState({
    items: [guestItem], guestItems: [guestItem], guestItemsOwnerId: null,
    customerCarts: {}, pendingMerge: null, pendingMergeBlocked: false, legacyMergeKey: null, legacyMergeOwner: null, ownerId: null, mode: 'guest',
    hydrated: true, syncing: false, syncError: '', syncOwner: null, retryVersion: 0,
    ...overrides,
  });
}

describe('client cart merge recovery', () => {
  it('hides persisted cart contents while authentication is loading', () => {
    resetStore({ items: [serverItem], guestItems: [], ownerId: customerA, mode: 'customer' });
    const before = useCartStore.getState();
    const view = selectVisibleCart(before, { loading: true, userId: null });
    assert.deepEqual(view.items, []);
    assert.equal(view.visibility, 'loading');
    assert.deepEqual(useCartStore.getState().items, [serverItem], 'visibility filtering does not erase stored items');
  });

  it('hides account A immediately when auth resolves as account B, then reveals only B after its cart loads', () => {
    const accountAItem = { ...serverItem, id: 10, name: 'A private item' };
    const accountBItem = { ...serverItem, id: 20, name: 'B private item' };
    resetStore({ items: [accountAItem], guestItems: [], customerCarts: { [customerA]: [accountAItem] }, ownerId: customerA, mode: 'customer' });
    const switched = selectVisibleCart(useCartStore.getState(), { loading: false, userId: customerB });
    assert.deepEqual(switched.items, []);
    assert.equal(switched.visibility, 'loading');
    assert.deepEqual(useCartStore.getState().items, [accountAItem], 'A data remains stored while hidden');

    useCartStore.setState({ items: [accountBItem], ownerId: customerB, mode: 'customer' });
    assert.deepEqual(selectVisibleCart(useCartStore.getState(), { loading: false, userId: customerB }).items, [accountBItem]);
    assert.deepEqual(useCartStore.getState().items, [accountBItem]);
    assert.deepEqual(useCartStore.getState().customerCarts[customerA], [accountAItem], 'switching accounts does not erase A cached data');
    assert.deepEqual(selectVisibleCart(useCartStore.getState(), { loading: false, userId: customerA }).items, [], 'A data remains hidden until A is active again');
    useCartStore.getState().setCustomerItems(customerA, [accountAItem]);
    assert.deepEqual(selectVisibleCart(useCartStore.getState(), { loading: false, userId: customerA }).items, [accountAItem]);
  });

  it('hides account-bound pending or rejected items on logout but preserves them for their owner', () => {
    const pending = { ownerId: customerA, key: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', items: [{ productId: 7, quantity: 2 }] };
    resetStore({ items: [serverItem], guestItems: [guestItem], ownerId: customerA, mode: 'customer', pendingMerge: pending });
    assert.equal(selectVisibleCart(useCartStore.getState(), { loading: false, userId: null }).visibility, 'recovery');
    useCartStore.getState().restoreGuestItems();
    assert.deepEqual(useCartStore.getState().items, [serverItem], 'active account data is retained in storage');
    assert.deepEqual(useCartStore.getState().guestItems, [guestItem]);
    assert.deepEqual(useCartStore.getState().customerCarts[customerA] ?? [], [], 'unrelated account cache remains untouched');
    assert.deepEqual(selectVisibleCart(useCartStore.getState(), { loading: false, userId: null }).items, []);
    assert.equal(useCartStore.getState().completePendingMerge(customerA, pending.key, [serverItem], []), true);
    assert.deepEqual(selectVisibleCart(useCartStore.getState(), { loading: false, userId: customerA }).items, [serverItem]);

    resetStore({ items: [], guestItems: [guestItem], guestItemsOwnerId: customerA, ownerId: null, mode: 'guest' });
    assert.deepEqual(selectVisibleCart(useCartStore.getState(), { loading: false, userId: null }).items, []);
  });

  it('shows genuine guest items after auth resolves signed out', () => {
    resetStore({ items: [guestItem], guestItems: [guestItem], ownerId: null, mode: 'guest' });
    const view = selectVisibleCart(useCartStore.getState(), { loading: false, userId: null });
    assert.deepEqual(view.items, [guestItem]);
    assert.equal(view.visibility, 'guest');
  });

  it('shows a customer cart only to the matching authenticated owner and again when that owner returns', () => {
    resetStore({ items: [serverItem], guestItems: [], ownerId: customerA, mode: 'customer' });
    assert.deepEqual(selectVisibleCart(useCartStore.getState(), { loading: false, userId: customerA }).items, [serverItem]);
    assert.deepEqual(selectVisibleCart(useCartStore.getState(), { loading: false, userId: customerB }).items, []);
    assert.deepEqual(selectVisibleCart(useCartStore.getState(), { loading: false, userId: customerA }).items, [serverItem]);
  });

  it('exposes recovery metadata only through the selector to its explicit owner', () => {
    const pending: PendingCartMerge = { ownerId: customerA, key: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', items: [{ productId: 7, quantity: 2 }] };
    resetStore({
      items: [serverItem], guestItems: [], ownerId: customerA, mode: 'customer',
      pendingMerge: pending, pendingMergeBlocked: true,
      syncError: 'Account A needs manual merge recovery.', syncOwner: { kind: 'customer', userId: customerA },
    });

    const asB = selectVisibleCart(useCartStore.getState(), { loading: false, userId: customerB });
    assert.equal(asB.recovery, null, 'account B receives no key, status or error from A');
    assert.deepEqual(asB.items, []);
    const whileLoading = selectVisibleCart(useCartStore.getState(), { loading: true, userId: customerA });
    assert.equal(whileLoading.recovery, null, 'recovery metadata stays hidden until auth resolves');
    const signedOut = selectVisibleCart(useCartStore.getState(), { loading: false, userId: null });
    assert.equal(signedOut.recovery, null, 'logout does not expose customer recovery data to guests');

    const asA = selectVisibleCart(useCartStore.getState(), { loading: false, userId: customerA });
    assert.equal(asA.recovery?.pendingMerge?.key, pending.key);
    assert.equal(asA.recovery?.pendingMergeBlocked, true);
    assert.equal(asA.recovery?.syncError, 'Account A needs manual merge recovery.');
    assert.equal(useCartStore.getState().pendingMerge?.key, pending.key, 'filtering the view does not delete the pending operation');
  });

  it('only exposes a legacy recovery reference when its explicit owner is resolved', () => {
    resetStore({
      items: [serverItem], guestItems: [], ownerId: customerA, mode: 'customer',
      legacyMergeKey: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      legacyMergeOwner: { kind: 'customer', userId: customerA },
    });
    assert.equal(selectVisibleCart(useCartStore.getState(), { loading: true, userId: customerA }).recovery, null);
    assert.equal(selectVisibleCart(useCartStore.getState(), { loading: false, userId: customerB }).recovery, null);
    assert.equal(selectVisibleCart(useCartStore.getState(), { loading: false, userId: customerB }).legacyRecovery, null);
    assert.equal(selectVisibleCart(useCartStore.getState(), { loading: false, userId: null }).recovery, null);
    assert.equal(selectVisibleCart(useCartStore.getState(), { loading: false, userId: null }).legacyRecovery, null);
    assert.equal(selectVisibleCart(useCartStore.getState(), { loading: false, userId: customerA }).recovery?.legacyMergeKey, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
    assert.equal(useCartStore.getState().legacyMergeKey, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
  });

  it('provides manual support recovery instructions for an unowned legacy cart without exposing its key', () => {
    resetStore({
      items: [serverItem], guestItems: [], ownerId: customerA, mode: 'customer',
      legacyMergeKey: 'ffffffff-ffff-4fff-8fff-ffffffffffff', legacyMergeOwner: null,
    });
    const view = selectVisibleCart(useCartStore.getState(), { loading: false, userId: customerB });
    const notice = getLegacyRecoveryNotice(view);
    assert.equal(view.recovery, null, 'the unowned key is not included in account recovery metadata');
    assert.equal(notice?.supportEmail, LEGACY_RECOVERY_SUPPORT_EMAIL);
    assert.match(notice?.message ?? '', /could not be safely associated with an account/i);
    assert.match(notice?.message ?? '', /automatic recovery is disabled/i);
    assert.match(notice?.message ?? '', /duplicate items or data loss/i);
    assert.match(notice?.message ?? '', /manual recovery/i);
    assert.match(notice?.message ?? '', /do not clear this browser.s saved data/i);
    assert.doesNotMatch(notice?.message ?? '', /verify|sign in|log in/i);
    assert.equal(JSON.stringify(notice).includes('ffffffff-ffff-4fff-8fff-ffffffffffff'), false);
    assert.equal(useCartStore.getState().legacyMergeKey, 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'instructions do not clear the operation');
  });

  it('locks guest cart mutations while a merge is pending', () => {
    resetStore();
    const store = useCartStore.getState();
    const pending = store.beginPendingMerge(customerA, store.guestItems);
    assert.ok(pending);

    store.addItem({ ...guestItem, id: 8, quantity: 1 });
    store.updateQuantity(guestItem.id, 9);
    store.removeItem(guestItem.id);
    store.clearCart();

    assert.deepEqual(useCartStore.getState().guestItems, [guestItem]);
    assert.deepEqual(useCartStore.getState().items, [guestItem]);
    assert.deepEqual(useCartStore.getState().pendingMerge, pending);
  });

  it('retries after a network failure with the exact same key and payload', async () => {
    const operation: PendingCartMerge = { ownerId: customerA, key: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', items: [{ productId: 7, quantity: 2 }] };
    const calls: Array<{ path: string; key: string | null; body: string | null }> = [];
    let attempt = 0;
    const request = async (path: string, _token: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      calls.push({ path, key: headers.get('Idempotency-Key'), body: String(init.body ?? null) });
      attempt += 1;
      if (attempt === 1) throw new TypeError('network unavailable');
      return { items: [] };
    };

    await assert.rejects(sendPendingMerge(operation, 'token', request));
    await sendPendingMerge(operation, 'token', request);

    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], calls[1]);
    assert.equal(calls[1].key, operation.key);
    assert.equal(calls[1].body, JSON.stringify({ items: operation.items }));
  });

  it('rehydrates the immutable pending operation and reuses its key after a page reload', () => {
    resetStore();
    const state = useCartStore.getState();
    const pending = state.beginPendingMerge(customerA, state.guestItems);
    assert.ok(pending);
    const persisted = {
      items: state.items,
      guestItems: state.guestItems,
      pendingMerge: pending,
      pendingMergeBlocked: false,
      ownerId: state.ownerId,
      mode: state.mode,
    };
    const reloaded = hydrateCartState(persisted, state);
    useCartStore.setState(reloaded);
    const recovered = useCartStore.getState().beginPendingMerge(customerA, [{ ...guestItem, quantity: 99 }]);
    assert.equal(recovered?.key, pending.key);
    assert.deepEqual(recovered?.items, [{ productId: guestItem.id, quantity: guestItem.quantity }]);
  });

  it('preserves an older uncertain key and repeated sync decisions never create a new merge', () => {
    resetStore();
    const reloaded = hydrateCartState({
      items: [guestItem], guestItems: [guestItem], guestMergeKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    } as Partial<ReturnType<typeof useCartStore.getState>>, useCartStore.getState());
    useCartStore.setState(reloaded);
    assert.equal(useCartStore.getState().legacyMergeKey, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    useCartStore.getState().addItem({ ...guestItem, id: 8, quantity: 1 });
    assert.deepEqual(useCartStore.getState().guestItems, [guestItem]);
    assert.equal(useCartStore.getState().pendingMerge, null);

    let created = 0;
    let requests = 0;
    for (let effectRun = 0; effectRun < 3; effectRun += 1) {
      const plan = prepareCartSync({
        customerId: customerA,
        legacyMergeKey: useCartStore.getState().legacyMergeKey,
        pendingMerge: useCartStore.getState().pendingMerge,
        pendingMergeBlocked: useCartStore.getState().pendingMergeBlocked,
        guestItemsOwnerId: useCartStore.getState().guestItemsOwnerId,
        guestItems: useCartStore.getState().guestItems,
      }, () => {
        created += 1;
        return useCartStore.getState().beginPendingMerge(customerA, useCartStore.getState().guestItems);
      });
      if (plan.operation) requests += 1;
      assert.equal(plan.decision, 'legacy-recovery');
      assert.equal(plan.operation, null);
    }
    assert.equal(created, 0, 'legacy decision runs before UUID creation');
    assert.equal(requests, 0, 'repeated effects cannot send a new merge');
    assert.equal(useCartStore.getState().beginPendingMerge(customerA, [guestItem]), null, 'store-level guard also blocks callers bypassing CartSync');
    assert.equal(useCartStore.getState().legacyMergeKey, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  });

  it('does not send changed guest state when an earlier operation is unresolved', async () => {
    resetStore();
    const state = useCartStore.getState();
    const pending = state.beginPendingMerge(customerA, state.guestItems);
    assert.ok(pending);
    useCartStore.setState({ guestItems: [{ ...guestItem, quantity: 6 }] });
    let sentBody = '';
    await sendPendingMerge(pending, 'token', async (_path, _token, init = {}) => {
      sentBody = String(init.body);
      return { items: [] };
    });
    assert.equal(sentBody, JSON.stringify({ items: [{ productId: guestItem.id, quantity: guestItem.quantity }] }));
  });

  it('keeps a 409 operation and guest items locked without scheduling automatic retries', () => {
    resetStore();
    const state = useCartStore.getState();
    const pending = state.beginPendingMerge(customerA, state.guestItems);
    assert.ok(pending);
    const error = new CartRequestError('conflict', 409);
    assert.equal(isUnrecoverableMergeError(error), true);
    useCartStore.getState().blockPendingMerge(pending.key, 'Manual recovery required.');
    const retryVersion = useCartStore.getState().retryVersion;
    useCartStore.getState().retrySync();
    assert.equal(useCartStore.getState().pendingMerge?.key, pending.key);
    assert.equal(useCartStore.getState().pendingMergeBlocked, true);
    assert.equal(useCartStore.getState().retryVersion, retryVersion);
    assert.deepEqual(useCartStore.getState().guestItems, [guestItem]);
  });

  it('completes only the matching operation and does not overwrite attempted newer mutations', () => {
    resetStore();
    const state = useCartStore.getState();
    const pending = state.beginPendingMerge(customerA, state.guestItems);
    assert.ok(pending);
    state.addItem({ ...guestItem, id: 8, quantity: 1 });
    assert.equal(useCartStore.getState().items.some((item) => item.id === 8), false);

    assert.equal(useCartStore.getState().completePendingMerge(customerA, pending.key, [serverItem], []), true);
    assert.deepEqual(useCartStore.getState().items, [serverItem]);
    assert.equal(useCartStore.getState().pendingMerge, null);
    assert.equal(useCartStore.getState().completePendingMerge(customerA, pending.key, [], []), false);
  });

  it('preserves pending data through logout and prevents another account from recovering it', () => {
    resetStore();
    const state = useCartStore.getState();
    const pending = state.beginPendingMerge(customerA, state.guestItems);
    assert.ok(pending);
    useCartStore.getState().restoreGuestItems();
    assert.deepEqual(useCartStore.getState().items, [guestItem], 'stored account data is preserved while visibility changes');
    assert.deepEqual(selectVisibleCart(useCartStore.getState(), { loading: false, userId: null }).items, [], 'account-bound pending items are hidden on logout');
    assert.deepEqual(useCartStore.getState().guestItems, [guestItem], 'the pending snapshot remains recoverable');
    assert.equal(useCartStore.getState().pendingMerge?.key, pending.key);
    assert.equal(canRecoverPendingMerge(pending, customerB), false);
    assert.equal(canRecoverPendingMerge(pending, customerA), true);
    assert.deepEqual(selectVisibleCart(useCartStore.getState(), { loading: false, userId: customerB }).items, []);
    assert.deepEqual(useCartStore.getState().guestItems, [guestItem]);
    assert.equal(useCartStore.getState().pendingMerge?.key, pending.key);
    useCartStore.getState().setCustomerItems(customerB, [{ ...serverItem, id: 8 }]);
    assert.equal(useCartStore.getState().items[0].id, 8, 'the other account receives only its own server cart');
    assert.deepEqual(useCartStore.getState().guestItems, [guestItem], 'the unresolved guest snapshot remains preserved');
    assert.equal(useCartStore.getState().pendingMerge?.ownerId, customerA);
    useCartStore.getState().restoreGuestItems();
    assert.deepEqual(selectVisibleCart(useCartStore.getState(), { loading: false, userId: null }).items, [], 'logging out of the other account does not expose account A data');

    useCartStore.setState({ items: [{ ...serverItem, id: 8 }], ownerId: customerB, mode: 'customer' });
    assert.deepEqual(selectVisibleCart(useCartStore.getState(), { loading: false, userId: customerA }).items, [], 'switching back to A hides B cart while A merge is unresolved');
    assert.deepEqual(useCartStore.getState().guestItems, [guestItem]);
  });

  it('keeps normal guest merge and successful synchronization available', () => {
    resetStore();
    let created = 0;
    const plan = prepareCartSync({
      customerId: customerA,
      legacyMergeKey: null,
      pendingMerge: null,
      pendingMergeBlocked: false,
      guestItemsOwnerId: null,
      guestItems: [guestItem],
    }, (ownerId, guestItems) => {
      created += 1;
      return useCartStore.getState().beginPendingMerge(ownerId, guestItems);
    });
    assert.equal(plan.decision, 'merge');
    assert.ok(plan.operation);
    assert.equal(created, 1);
    assert.equal(useCartStore.getState().completePendingMerge(customerA, plan.operation.key, [serverItem], []), true);
    assert.deepEqual(useCartStore.getState().items, [serverItem]);
    assert.equal(useCartStore.getState().pendingMerge, null);
  });
});

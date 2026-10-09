import type { VisibleCart } from '../store/cartStore';

export const LEGACY_RECOVERY_SUPPORT_EMAIL = 'pitcrew@rcmega.com';

export function getLegacyRecoveryNotice(cart: Pick<VisibleCart, 'legacyRecovery'>) {
  if (cart.legacyRecovery !== 'unowned') return null;
  return {
    title: 'Older saved cart needs manual recovery',
    message: 'This older saved cart could not be safely associated with an account. Automatic recovery is disabled to prevent duplicate items or data loss. Contact store support for manual recovery, and do not clear this browser’s saved data until the issue is resolved.',
    supportEmail: LEGACY_RECOVERY_SUPPORT_EMAIL,
  };
}

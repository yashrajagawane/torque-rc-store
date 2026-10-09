import { useAuth } from '../auth/AuthContext';
import { selectVisibleCart, useCartStore } from '../store/cartStore';

/** A synchronous, auth-aware view used anywhere cart contents or counts are rendered. */
export function useVisibleCart() {
  const auth = useAuth();
  const cart = useCartStore();
  return selectVisibleCart(cart, { loading: auth.loading, userId: auth.user?.id ?? null });
}

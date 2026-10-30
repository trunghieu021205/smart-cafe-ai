import { useAuthStore } from '@/features/auth/store';
import { usePlacedOrders } from '@/features/dine-in/placed-orders';
import { useDineInCartStore } from '@/features/dine-in/store';
import { resetSubmitState } from '@/features/dine-in/submit';
import { resetDb } from '@/mocks/db';
import { mockConfig } from '@/mocks/utils';
import { storeApi } from '@/shared/api';
import type { NewCartLine } from '@/features/dine-in/cart';
import type { User } from '@/shared/types';

export const TABLE_CODE = 'QR-B1-T01';

export const latte: NewCartLine = {
  productId: 1, productName: 'Cà phê sữa đá', variantId: 12, variantName: 'M', unitPrice: 35_000,
  options: [
    { optionId: 101, optionName: '100% đường', extraPrice: 0, quantity: 1 },
    { optionId: 104, optionName: 'Trân châu', extraPrice: 10_000, quantity: 1 },
  ],
};

/** Đưa mọi store/mock về trạng thái ban đầu giữa các test. */
export function resetWorld(): void {
  resetDb();
  mockConfig.latencyMs = 0;
  mockConfig.enforceAuth = false;
  resetSubmitState();
  useDineInCartStore.setState({ tableSessionId: null, tableCode: null, sessionCode: null, lines: [] });
  usePlacedOrders.setState({ orders: [] });
  if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
  useAuthStore.setState({ status: 'anonymous', accessToken: null, user: null, roleName: null });
}

/** Mở phiên bàn thật qua MSW rồi gắn vào giỏ — giống DineInTablePage làm khi vào /dine-in/table/:code. */
export async function startTableSession(code = TABLE_CODE): Promise<number> {
  const session = await storeApi.openTableSession({ qrCode: code });
  useDineInCartStore.getState().bindSession(session.id, code, session.sessionCode);
  return session.id;
}

export const fakeUser = (over: Partial<User> = {}): User => ({
  id: 'u-1', fullName: 'Nhân viên Test', roleId: 1, status: 'Active',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...over,
});

export function loginAs(roleName: 'Customer' | 'Staff', over: Partial<User> = {}): void {
  useAuthStore.setState({ status: 'authenticated', accessToken: 't', user: fakeUser(over), roleName });
}

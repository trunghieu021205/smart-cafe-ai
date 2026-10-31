import { cashierHandlers } from './cashier'
import { catalogHandlers } from './catalog';
import { orderHandlers } from './order';
import { storeHandlers } from './store';
import { orderReadHandlers } from './order-read';
import { identityHandlers } from './identity';
import { authFlowHandlers } from './auth-flow';
import { branchHandlers } from './branch';
import { voucherHandlers } from './voucher';
import { paymentHandlers } from './payment';
import { inventoryHandlers } from './inventory';

export const handlers = [...cashierHandlers, ...catalogHandlers, ...storeHandlers, ...orderHandlers, ...identityHandlers, ...orderReadHandlers, ...authFlowHandlers, ...branchHandlers, ...voucherHandlers, ...paymentHandlers, ...inventoryHandlers];
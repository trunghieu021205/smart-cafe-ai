import type { Ingredient, Inventory, InventoryLog, InventoryTransactionType } from '@/shared/types';
import { BRANCH_ID } from './fixtures';

/**
 * Dữ liệu kho cho 1 chi nhánh (BRANCH_ID). Đơn vị cơ sở là g / ml / cái (đúng comment của Ingredient.unit).
 * Trạng thái đúng theo quy tắc UI: available = tồn − đang giữ; Hết ⇔ available ≤ 0; Sắp hết ⇔ available ≤ reorderLevel.
 *   • Hết hàng : Trân châu (id 9)
 *   • Sắp hết  : Arabica (2), Sữa đặc (4), Bột kem béo (10)
 *   • Còn lại  : Ổn
 */
interface SeedIngredient {
  ingredient: Ingredient;
  stock: number;
  reserved: number;
  reorderLevel: number;
  averageCost: number; // VND / đơn vị cơ sở
  /** Lượng tiêu thụ tự động trung bình mỗi ngày (đơn vị cơ sở) — dùng sinh log Auto_Deduct 7 ngày. */
  dailyUse: number;
}

const ing = (id: number, name: string, unit: string): Ingredient => ({ id, name, unit, isActive: true });

const SEED: SeedIngredient[] = [
  { ingredient: ing(1, 'Cà phê hạt Robusta', 'g'), stock: 15000, reserved: 800, reorderLevel: 5000, averageCost: 180, dailyUse: 1400 },
  { ingredient: ing(2, 'Cà phê hạt Arabica', 'g'), stock: 1200, reserved: 400, reorderLevel: 3000, averageCost: 320, dailyUse: 900 },
  { ingredient: ing(3, 'Sữa tươi không đường', 'ml'), stock: 24000, reserved: 1500, reorderLevel: 10000, averageCost: 32, dailyUse: 3200 },
  { ingredient: ing(4, 'Sữa đặc', 'ml'), stock: 2500, reserved: 600, reorderLevel: 5000, averageCost: 55, dailyUse: 700 },
  { ingredient: ing(5, 'Trà đen', 'g'), stock: 6000, reserved: 0, reorderLevel: 2000, averageCost: 210, dailyUse: 450 },
  { ingredient: ing(6, 'Syrup đường mía', 'ml'), stock: 8500, reserved: 200, reorderLevel: 3000, averageCost: 48, dailyUse: 600 },
  { ingredient: ing(7, 'Bột matcha', 'g'), stock: 4200, reserved: 100, reorderLevel: 2000, averageCost: 900, dailyUse: 250 },
  { ingredient: ing(8, 'Đường cát', 'g'), stock: 10000, reserved: 0, reorderLevel: 3000, averageCost: 22, dailyUse: 800 },
  { ingredient: ing(9, 'Trân châu đen', 'g'), stock: 300, reserved: 300, reorderLevel: 1500, averageCost: 85, dailyUse: 500 },
  { ingredient: ing(10, 'Bột kem béo', 'g'), stock: 2200, reserved: 300, reorderLevel: 2000, averageCost: 120, dailyUse: 350 },
  { ingredient: ing(11, 'Ly nhựa 360ml', 'cái'), stock: 900, reserved: 50, reorderLevel: 300, averageCost: 650, dailyUse: 80 },
  { ingredient: ing(12, 'Bánh croissant', 'cái'), stock: 40, reserved: 12, reorderLevel: 10, averageCost: 14000, dailyUse: 8 },
];

const DAY_MS = 86_400_000;

/** Datetime không kèm timezone (UTC) — cùng dạng với nowNaive() trong db.ts. */
const naiveAt = (now: number, daysAgo: number, hour: number): string =>
  new Date(now - daysAgo * DAY_MS + (hour - 12) * 3_600_000).toISOString().slice(0, 19);

interface RawLog {
  ingredientId: number;
  type: InventoryTransactionType;
  qty: number;
  daysAgo: number;
  hour: number;
  reason?: string;
  by?: string | null;
  refType?: string;
  refId?: string;
}

/** Log thủ công/nhập hàng có chủ đích để phủ đủ 6 loại giao dịch. */
const EXTRA_LOGS: RawLog[] = [
  { ingredientId: 1, type: 'Import', qty: 10000, daysAgo: 5, hour: 8, by: 'u-manager', refType: 'PurchaseOrder', refId: 'PO-1001' },
  { ingredientId: 1, type: 'Stocktake', qty: -150, daysAgo: 3, hour: 21, reason: 'Kiểm kê cuối tuần, hao hụt khi xay', by: 'u-manager' },
  { ingredientId: 2, type: 'Import', qty: 3000, daysAgo: 6, hour: 8, by: 'u-manager', refType: 'PurchaseOrder', refId: 'PO-1002' },
  { ingredientId: 2, type: 'Adjustment', qty: -200, daysAgo: 1, hour: 10, reason: 'Điều chỉnh sau khi cân lại bao hạt', by: 'u-manager' },
  { ingredientId: 3, type: 'Import', qty: 24000, daysAgo: 4, hour: 7, by: 'u-manager', refType: 'PurchaseOrder', refId: 'PO-1003' },
  { ingredientId: 3, type: 'Refund', qty: 240, daysAgo: 2, hour: 15, by: null, refType: 'Order', refId: '7' },
  { ingredientId: 4, type: 'Waste', qty: -500, daysAgo: 3, hour: 17, reason: 'Hộp sữa đặc bị phồng, bỏ', by: 'u-staff' },
  { ingredientId: 7, type: 'Import', qty: 2000, daysAgo: 5, hour: 9, by: 'u-manager', refType: 'PurchaseOrder', refId: 'PO-1004' },
  { ingredientId: 9, type: 'Waste', qty: -800, daysAgo: 1, hour: 20, reason: 'Trân châu nấu dư cuối ngày', by: 'u-staff' },
  { ingredientId: 12, type: 'Import', qty: 60, daysAgo: 2, hour: 6, by: 'u-manager', refType: 'PurchaseOrder', refId: 'PO-1005' },
];

export interface InventorySeed {
  ingredients: Ingredient[];
  inventory: Inventory[];
  logs: InventoryLog[];
}

/**
 * Sinh seed xác định (không dùng random). `balanceAfter` được tính ngược từ tồn kho hiện tại để chuỗi log luôn khớp:
 * tồn đầu kỳ = tồn hiện tại − tổng thay đổi; nếu âm thì thêm 1 log Import mở đầu để bù.
 */
export function buildInventorySeed(now: number = Date.now()): InventorySeed {
  const ingredients = SEED.map((s) => s.ingredient);
  const inventory: Inventory[] = SEED.map((s, i) => ({
    id: i + 1,
    branchId: BRANCH_ID,
    ingredientId: s.ingredient.id,
    quantityInStock: s.stock,
    reservedQuantity: s.reserved,
    reorderLevel: s.reorderLevel,
    averageCost: s.averageCost,
    version: 3 + (i % 4),
    updatedAt: new Date(now - (i + 1) * 3_600_000).toISOString().slice(0, 19),
  }));

  const raw: RawLog[] = [...EXTRA_LOGS];
  SEED.forEach((s, i) => {
    for (let d = 6; d >= 0; d -= 1) {
      // Dao động nhẹ theo ngày để biểu đồ 7 ngày không phẳng
      const factor = 0.7 + (((i + 2) * (d + 3)) % 7) * 0.1;
      const qty = -Math.max(1, Math.round(s.dailyUse * factor));
      raw.push({
        ingredientId: s.ingredient.id, type: 'Auto_Deduct', qty, daysAgo: d, hour: 14, by: null,
        refType: 'Order', refId: String(100 + i * 10 + d),
      });
    }
  });

  const logs: InventoryLog[] = [];
  let nextId = 1;
  for (const s of SEED) {
    const mine = raw
      .filter((r) => r.ingredientId === s.ingredient.id)
      .sort((a, b) => b.daysAgo - a.daysAgo || a.hour - b.hour);
    const delta = mine.reduce((sum, r) => sum + r.qty, 0);
    let balance = s.stock - delta;
    if (balance < 0) {
      mine.unshift({ ingredientId: s.ingredient.id, type: 'Import', qty: -balance, daysAgo: 7, hour: 8, by: 'u-manager', refType: 'PurchaseOrder', refId: `PO-OPEN-${s.ingredient.id}` });
      balance = 0;
    }
    for (const r of mine) {
      balance += r.qty;
      logs.push({
        id: nextId++,
        idempotencyKey: null,
        branchId: BRANCH_ID,
        ingredientId: r.ingredientId,
        transactionType: r.type,
        quantityChanged: r.qty,
        balanceAfter: balance,
        referenceType: r.refType ?? null,
        referenceId: r.refId ?? null,
        reason: r.reason ?? null,
        createdBy: r.by ?? null,
        createdAt: naiveAt(now, r.daysAgo, r.hour),
      });
    }
  }
  return { ingredients, inventory, logs };
}

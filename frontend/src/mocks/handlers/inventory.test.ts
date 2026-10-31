import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AdjustInventoryInput, InventoryItemView, InventoryLog, Page } from '@/shared/types';
import { BRANCH_ID, db, resetDb } from '../db';
import { buildInventorySeed } from '../inventory-seed';
import { mockConfig, url } from '../utils';
import { MOCK_PASSWORD, resetAuthMock } from './identity';
import { handlers } from './index';

const server = setupServer(...handlers);
beforeAll(() => server.listen());
afterAll(() => server.close());
beforeEach(() => {
  resetDb();
  resetAuthMock();
  mockConfig.latencyMs = 0;
  mockConfig.enforceAuth = false;
});
afterEach(() => server.resetHandlers());

interface ErrBody { message: string; code: string }

async function loginToken(identifier: string): Promise<string> {
  const res = await fetch(url('/identity/auth/login'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password: MOCK_PASSWORD }),
  });
  return ((await res.json()) as { accessToken: string }).accessToken;
}

async function get<T>(path: string) {
  const res = await fetch(url(path));
  return { status: res.status, body: (await res.json()) as T };
}

async function adjust(body: Partial<AdjustInventoryInput>, token?: string) {
  const res = await fetch(url('/inventory/adjustments'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as InventoryLog & ErrBody };
}

const stockOf = (ingredientId: number) => db.inventory.find((r) => r.ingredientId === ingredientId)!;
/** Body hợp lệ cho Cà phê Robusta (id 1) theo version hiện tại. */
const validAdjust = (over: Partial<AdjustInventoryInput> = {}): AdjustInventoryInput => ({
  branchId: BRANCH_ID, ingredientId: 1, transactionType: 'Adjustment', quantityChanged: -100, reason: 'Kiểm lại kho', version: stockOf(1).version, ...over,
});

describe('seed kho', () => {
  it('~12 nguyên liệu, ≥2 sắp hết, đúng 1 hết, log phủ đủ 6 loại', () => {
    const seed = buildInventorySeed();
    expect(seed.ingredients).toHaveLength(12);
    const views = seed.inventory.map((r) => r.quantityInStock - r.reservedQuantity);
    expect(views.filter((a) => a <= 0)).toHaveLength(1);
    const low = seed.inventory.filter((r) => r.quantityInStock - r.reservedQuantity > 0 && r.quantityInStock - r.reservedQuantity <= r.reorderLevel);
    expect(low.length).toBeGreaterThanOrEqual(2);
    expect(new Set(seed.logs.map((l) => l.transactionType))).toEqual(
      new Set(['Import', 'Auto_Deduct', 'Refund', 'Waste', 'Adjustment', 'Stocktake']),
    );
  });

  it('chuỗi log khớp: balanceAfter không âm và log cuối của mỗi nguyên liệu = tồn kho hiện tại', () => {
    const seed = buildInventorySeed();
    for (const row of seed.inventory) {
      const mine = seed.logs.filter((l) => l.ingredientId === row.ingredientId);
      expect(mine.length).toBeGreaterThan(0);
      expect(mine.every((l) => l.balanceAfter >= 0)).toBe(true);
      expect(mine[mine.length - 1].balanceAfter).toBe(row.quantityInStock);
    }
  });
});

describe('GET /inventory/stock', () => {
  it('trả toàn bộ nguyên liệu của chi nhánh kèm available/isLow, xếp theo tên', async () => {
    const { status, body } = await get<InventoryItemView[]>(`/inventory/stock?branchId=${BRANCH_ID}`);
    expect(status).toBe(200);
    expect(body).toHaveLength(12);
    const names = body.map((i) => i.ingredientName);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'vi')));
    for (const item of body) {
      expect(item.available).toBe(item.quantityInStock - item.reservedQuantity);
      expect(item.isLow).toBe(item.available <= item.reorderLevel);
    }
  });

  it('lọc q không phân biệt hoa thường và dấu', async () => {
    const { body } = await get<InventoryItemView[]>(`/inventory/stock?branchId=${BRANCH_ID}&q=${encodeURIComponent('CA PHE')}`);
    expect(body.map((i) => i.ingredientName).sort()).toEqual(['Cà phê hạt Arabica', 'Cà phê hạt Robusta']);
  });

  it('lowOnly=true chỉ trả hàng sắp hết + hết (≥ 3 dòng, gồm cả hàng hết)', async () => {
    const { body } = await get<InventoryItemView[]>(`/inventory/stock?branchId=${BRANCH_ID}&lowOnly=true`);
    expect(body.length).toBeGreaterThanOrEqual(3);
    expect(body.every((i) => i.available <= i.reorderLevel)).toBe(true);
    expect(body.some((i) => i.available <= 0)).toBe(true);
  });

  it('thiếu branchId → 400; chi nhánh khác → rỗng', async () => {
    expect((await get<ErrBody>('/inventory/stock')).status).toBe(400);
    expect((await get<InventoryItemView[]>('/inventory/stock?branchId=99')).body).toEqual([]);
  });
});

describe('GET /inventory/logs', () => {
  it('lọc theo ingredientId + transactionType, mới nhất trước', async () => {
    const { body } = await get<Page<InventoryLog>>(`/inventory/logs?branchId=${BRANCH_ID}&ingredientId=1&transactionType=Auto_Deduct`);
    expect(body.total).toBe(7);
    expect(body.items.every((l) => l.ingredientId === 1 && l.transactionType === 'Auto_Deduct')).toBe(true);
    const times = body.items.map((l) => l.createdAt);
    expect(times).toEqual([...times].sort().reverse());
  });

  it('phân trang và lọc from/to', async () => {
    const page1 = await get<Page<InventoryLog>>(`/inventory/logs?branchId=${BRANCH_ID}&ingredientId=1&pageSize=5&page=1`);
    const page2 = await get<Page<InventoryLog>>(`/inventory/logs?branchId=${BRANCH_ID}&ingredientId=1&pageSize=5&page=2`);
    expect(page1.body.items).toHaveLength(5);
    expect(page2.body.page).toBe(2);
    expect(page1.body.items.map((l) => l.id).some((id) => page2.body.items.some((l) => l.id === id))).toBe(false);

    const from = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const recent = await get<Page<InventoryLog>>(`/inventory/logs?branchId=${BRANCH_ID}&ingredientId=1&from=${encodeURIComponent(from)}`);
    expect(recent.body.total).toBeGreaterThan(0);
    expect(recent.body.total).toBeLessThan(page1.body.total);
  });

  it('transactionType hoặc from sai → 400', async () => {
    expect((await get<ErrBody>(`/inventory/logs?branchId=${BRANCH_ID}&transactionType=Nope`)).status).toBe(400);
    expect((await get<ErrBody>(`/inventory/logs?branchId=${BRANCH_ID}&from=hom-qua`)).status).toBe(400);
  });
});

describe('POST /inventory/adjustments', () => {
  it('Manager điều chỉnh thành công: đổi tồn, tăng version, ghi 1 log', async () => {
    const token = await loginToken('manager@smartcafe.vn');
    const before = { ...stockOf(1) };
    const logsBefore = db.inventoryLogs.length;

    const { status, body } = await adjust(validAdjust({ quantityChanged: -250 }), token);
    expect(status).toBe(201);
    expect(body).toMatchObject({ transactionType: 'Adjustment', quantityChanged: -250, balanceAfter: before.quantityInStock - 250, reason: 'Kiểm lại kho' });
    expect(stockOf(1).quantityInStock).toBe(before.quantityInStock - 250);
    expect(stockOf(1).version).toBe(before.version + 1);
    expect(db.inventoryLogs).toHaveLength(logsBefore + 1);
    expect(db.inventoryLogs[db.inventoryLogs.length - 1].id).toBe(body.id);
  });

  it('thiếu hoặc rỗng reason → 400, không đổi dữ liệu', async () => {
    const token = await loginToken('manager@smartcafe.vn');
    const before = stockOf(1).quantityInStock;
    expect((await adjust(validAdjust({ reason: '   ' }), token)).status).toBe(400);
    const noReason: Partial<AdjustInventoryInput> = validAdjust();
    delete noReason.reason;
    expect((await adjust(noReason, token)).status).toBe(400);
    expect(stockOf(1).quantityInStock).toBe(before);
  });

  it('Waste với số lượng dương → 400', async () => {
    const token = await loginToken('manager@smartcafe.vn');
    const { status, body } = await adjust(validAdjust({ transactionType: 'Waste', quantityChanged: 50 }), token);
    expect(status).toBe(400);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect((await adjust(validAdjust({ transactionType: 'Waste', quantityChanged: -50 }), token)).status).toBe(201);
  });

  it('version lệch → 409 VERSION_CONFLICT và không đổi gì', async () => {
    const token = await loginToken('manager@smartcafe.vn');
    const before = { ...stockOf(1) };
    const { status, body } = await adjust(validAdjust({ version: before.version - 1 }), token);
    expect(status).toBe(409);
    expect(body.code).toBe('VERSION_CONFLICT');
    expect(stockOf(1)).toEqual(before);
  });

  it('Staff → 403, chưa đăng nhập → 401, Manager chi nhánh khác → 403', async () => {
    const staff = await loginToken('staff@smartcafe.vn');
    const denied = await adjust(validAdjust(), staff);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('FORBIDDEN');
    expect((await adjust(validAdjust())).status).toBe(401);
    const manager = await loginToken('manager@smartcafe.vn');
    expect((await adjust(validAdjust({ branchId: 2 }), manager)).status).toBe(403);
  });

  it('giảm vượt tồn kho → 400 INSUFFICIENT_STOCK; thiếu version → 400; nguyên liệu lạ → 404', async () => {
    const token = await loginToken('manager@smartcafe.vn');
    expect((await adjust(validAdjust({ quantityChanged: -9_999_999 }), token)).body.code).toBe('INSUFFICIENT_STOCK');
    const noVersion: Partial<AdjustInventoryInput> = validAdjust();
    delete noVersion.version;
    expect((await adjust(noVersion, token)).status).toBe(400);
    expect((await adjust(validAdjust({ ingredientId: 999 }), token)).status).toBe(404);
  });
});

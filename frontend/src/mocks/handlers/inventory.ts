import { http, HttpResponse } from 'msw';
import type {
  AdjustInventoryInput, Inventory, InventoryItemView, InventoryLog, InventoryTransactionType, Page,
} from '@/shared/types';
import { db, nowNaive } from '../db';
import { fail, guarded, readJson, requireAuth, url } from '../utils';
import { accountFromRequest, hasMockToken, type MockAccount } from './identity';

const ALL_TYPES: InventoryTransactionType[] = ['Import', 'Auto_Deduct', 'Refund', 'Waste', 'Adjustment', 'Stocktake'];
const ADJUST_TYPES: AdjustInventoryInput['transactionType'][] = ['Waste', 'Adjustment', 'Stocktake'];

const invalid = (message: string): never => fail(400, 'VALIDATION_ERROR', message);

function intParam(sp: URLSearchParams, name: string, opts: { required?: boolean; fallback?: number; min?: number; max?: number } = {}): number | undefined {
  const raw = sp.get(name);
  if (raw === null || raw === '') {
    if (opts.required) invalid(`Thiếu ${name}`);
    return opts.fallback;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < (opts.min ?? 1) || n > (opts.max ?? Number.POSITIVE_INFINITY)) invalid(`${name} không hợp lệ`);
  return n;
}

/** Bỏ dấu + thường hoá để tìm "ca phe" ra "Cà phê". */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').toLowerCase().trim();

/** createdAt của mock không kèm timezone (UTC) → thêm 'Z' trước khi so sánh. */
const ts = (value: string): number => Date.parse(/(Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`);

function timeParam(sp: URLSearchParams, name: 'from' | 'to'): number | undefined {
  const raw = sp.get(name);
  if (!raw) return undefined;
  const t = ts(raw);
  if (Number.isNaN(t)) invalid(`${name} không phải thời điểm hợp lệ`);
  return t;
}

/** Cùng quy tắc với UI: available = tồn − đang giữ; sắp hết ⇔ available ≤ reorderLevel (bao gồm cả hết hàng). */
export function toInventoryView(row: Inventory): InventoryItemView {
  const ingredient = db.ingredients.find((i) => i.id === row.ingredientId);
  const available = row.quantityInStock - row.reservedQuantity;
  return {
    ...row,
    ingredientName: ingredient?.name ?? `Nguyên liệu #${row.ingredientId}`,
    unit: ingredient?.unit ?? '',
    available,
    isLow: available <= row.reorderLevel,
  };
}

/** Quản lý phải đăng nhập (401) và đúng vai trò (403). Token do mock cấp nhưng hết hạn → accountFromRequest trả undefined → 401. */
function requireManager(request: Request): MockAccount {
  const account = accountFromRequest(request);
  if (!account) {
    if (hasMockToken(request)) fail(401, 'UNAUTHORIZED', 'Phiên đăng nhập không còn hợp lệ');
    return fail(401, 'UNAUTHORIZED', 'Chưa đăng nhập');
  }
  if (account.roleName !== 'Manager') fail(403, 'FORBIDDEN', 'Chỉ quản lý mới được điều chỉnh kho');
  return account;
}

function parseAdjustment(body: Partial<AdjustInventoryInput> | null): AdjustInventoryInput {
  if (!body || typeof body !== 'object') return invalid('Body không hợp lệ');
  const { branchId, ingredientId, transactionType, quantityChanged, reason, version } = body;
  if (!Number.isInteger(branchId)) invalid('Thiếu branchId');
  if (!Number.isInteger(ingredientId)) invalid('Thiếu ingredientId');
  if (!transactionType || !ADJUST_TYPES.includes(transactionType)) invalid('transactionType chỉ nhận Waste | Adjustment | Stocktake');
  if (typeof quantityChanged !== 'number' || !Number.isFinite(quantityChanged) || quantityChanged === 0) invalid('Số lượng thay đổi phải khác 0');
  if (typeof reason !== 'string' || reason.trim() === '') invalid('Lý do là bắt buộc');
  if (transactionType === 'Waste' && (quantityChanged as number) >= 0) invalid('Hao hụt (Waste) phải có số lượng thay đổi âm');
  if (!Number.isInteger(version)) invalid('Thiếu version của tồn kho');
  return {
    branchId: branchId as number,
    ingredientId: ingredientId as number,
    transactionType: transactionType as AdjustInventoryInput['transactionType'],
    quantityChanged: quantityChanged as number,
    reason: (reason as string).trim(),
    version: version as number,
  };
}

export const inventoryHandlers = [
  // GET /inventory/stock?branchId=&q=&lowOnly=
  http.get(
    url('/inventory/stock'),
    guarded(({ request }) => {
      requireAuth(request);
      const sp = new URL(request.url).searchParams;
      const branchId = intParam(sp, 'branchId', { required: true });
      const q = fold(sp.get('q') ?? '');
      const lowOnly = sp.get('lowOnly') === 'true';

      const items = db.inventory
        .filter((row) => row.branchId === branchId)
        .map(toInventoryView)
        .filter((v) => (q === '' || fold(v.ingredientName).includes(q)) && (!lowOnly || v.isLow))
        .sort((a, b) => a.ingredientName.localeCompare(b.ingredientName, 'vi'));
      return HttpResponse.json<InventoryItemView[]>(items);
    }),
  ),

  // GET /inventory/logs?branchId=&ingredientId=&transactionType=&from=&to=&page=&pageSize=
  http.get(
    url('/inventory/logs'),
    guarded(({ request }) => {
      requireAuth(request);
      const sp = new URL(request.url).searchParams;
      const branchId = intParam(sp, 'branchId', { required: true });
      const ingredientId = intParam(sp, 'ingredientId');
      const type = sp.get('transactionType') as InventoryTransactionType | null;
      if (type && !ALL_TYPES.includes(type)) invalid(`transactionType không hợp lệ: ${type}`);
      const from = timeParam(sp, 'from');
      const to = timeParam(sp, 'to');
      const page = intParam(sp, 'page', { fallback: 1 }) as number;
      const pageSize = intParam(sp, 'pageSize', { fallback: 20, max: 200 }) as number;

      const rows = db.inventoryLogs
        .filter((l) => l.branchId === branchId)
        .filter((l) => ingredientId === undefined || l.ingredientId === ingredientId)
        .filter((l) => !type || l.transactionType === type)
        .filter((l) => (from === undefined || ts(l.createdAt) >= from) && (to === undefined || ts(l.createdAt) <= to))
        .sort((a, b) => ts(b.createdAt) - ts(a.createdAt) || b.id - a.id);

      const start = (page - 1) * pageSize;
      return HttpResponse.json<Page<InventoryLog>>({ items: rows.slice(start, start + pageSize), total: rows.length, page, pageSize });
    }),
  ),

  // POST /inventory/adjustments — Waste / Adjustment / Stocktake. Chỉ Manager của đúng chi nhánh; so version (optimistic lock).
  http.post(
    url('/inventory/adjustments'),
    guarded(async ({ request }) => {
      const manager = requireManager(request);
      const input = parseAdjustment(await readJson<Partial<AdjustInventoryInput> | null>(request));
      if (manager.branchId !== input.branchId) fail(403, 'FORBIDDEN', 'Bạn không quản lý chi nhánh này');

      const row = db.inventory.find((r) => r.branchId === input.branchId && r.ingredientId === input.ingredientId);
      if (!row) fail(404, 'INGREDIENT_NOT_FOUND', `Không tìm thấy nguyên liệu ${input.ingredientId} trong kho`);
      if (row.version !== input.version) fail(409, 'VERSION_CONFLICT', 'Tồn kho đã được người khác thay đổi, vui lòng tải lại');

      const balanceAfter = row.quantityInStock + input.quantityChanged;
      if (balanceAfter < 0) fail(400, 'INSUFFICIENT_STOCK', 'Số lượng giảm vượt quá tồn kho hiện có');

      row.quantityInStock = balanceAfter;
      row.version += 1;
      row.updatedAt = nowNaive();

      db.seq.inventoryLog += 1;
      const log: InventoryLog = {
        id: db.seq.inventoryLog,
        idempotencyKey: null,
        branchId: input.branchId,
        ingredientId: input.ingredientId,
        transactionType: input.transactionType,
        quantityChanged: input.quantityChanged,
        balanceAfter,
        referenceType: null,
        referenceId: null,
        reason: input.reason,
        createdBy: manager.id,
        createdAt: nowNaive(),
      };
      db.inventoryLogs.push(log);
      return HttpResponse.json<InventoryLog>(log, { status: 201 });
    }),
  ),
];

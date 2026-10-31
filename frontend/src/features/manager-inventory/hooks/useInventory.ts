import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { inventoryApi } from '@/shared/api';
import type { AdjustInventoryInput, InventoryLog } from '@/shared/types';

export const INVENTORY_KEY = ['manager', 'inventory'] as const;
export const inventoryStockKey = (branchId: number | null) => [...INVENTORY_KEY, 'stock', branchId] as const;
export const inventoryLogsKey = (branchId: number | null, ingredientId: number | null) =>
  [...INVENTORY_KEY, 'logs', branchId, ingredientId] as const;

/** Số log tối đa lấy cho 1 nguyên liệu: đủ cho danh sách lịch sử và biểu đồ tiêu thụ 7 ngày. */
export const LOG_PAGE_SIZE = 100;

/** Toàn bộ tồn kho của chi nhánh. Tìm kiếm / lọc "Sắp hết" làm phía client trên danh sách này (xem model.filterStock). */
export const useInventoryStock = (branchId: number | null) =>
  useQuery({
    queryKey: inventoryStockKey(branchId),
    queryFn: () => inventoryApi.listInventory({ branchId: branchId as number }),
    enabled: branchId !== null,
  });

/** Lịch sử biến động của một nguyên liệu (mới nhất trước). Chỉ tải khi drawer mở. */
export const useInventoryLogs = (branchId: number | null, ingredientId: number | null) =>
  useQuery({
    queryKey: inventoryLogsKey(branchId, ingredientId),
    queryFn: () => inventoryApi.listInventoryLogs({ branchId: branchId as number, ingredientId: ingredientId as number, pageSize: LOG_PAGE_SIZE }),
    enabled: branchId !== null && ingredientId !== null,
    select: (page): InventoryLog[] => page.items,
  });

/** Điều chỉnh kho. Dù thành công hay 409 đều tải lại tồn kho + log để UI luôn khớp server. */
export function useAdjustInventory() {
  const qc = useQueryClient();
  return useMutation<InventoryLog, Error, AdjustInventoryInput>({
    mutationFn: (input) => inventoryApi.adjustInventory(input),
    onSettled: () => qc.invalidateQueries({ queryKey: INVENTORY_KEY }),
  });
}

import { useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { API_ERROR_CODES, isApiError } from '@/shared/api';
import { cn } from '@/shared/lib/cn';
import type { InventoryItemView } from '@/shared/types';
import { Button, Input, Modal } from '@/shared/ui';
import { useAdjustInventory } from '../hooks/useInventory';
import { ADJUST_TYPE_OPTIONS, formatQty, makeAdjustSchema, type AdjustFormValues } from '../model';

const FORM_ID = 'inventory-adjust-form';

interface Props {
  branchId: number;
  item: InventoryItemView;
  onClose: () => void;
}

export function AdjustModal({ branchId, item, onClose }: Props) {
  // Version người dùng đang nhìn lúc mở form: nếu server đã đổi → 409 (không âm thầm gửi version mới hơn).
  const [baseVersion] = useState(item.version);
  const [serverError, setServerError] = useState<string | null>(null);
  const adjust = useAdjustInventory();
  const schema = useMemo(() => makeAdjustSchema(item.quantityInStock), [item.quantityInStock]);

  const {
    register, handleSubmit, control, formState: { errors },
  } = useForm<AdjustFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { transactionType: 'Adjustment', reason: '' },
  });

  const type = useWatch({ control, name: 'transactionType' });
  const qty = useWatch({ control, name: 'quantityChanged' });
  const hint = ADJUST_TYPE_OPTIONS.find((o) => o.value === type)?.hint;
  const after = typeof qty === 'number' && Number.isFinite(qty) ? item.quantityInStock + qty : null;

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await adjust.mutateAsync({
        branchId,
        ingredientId: item.ingredientId,
        transactionType: values.transactionType,
        quantityChanged: values.quantityChanged,
        reason: values.reason.trim(),
        version: baseVersion,
      });
      toast.success('Đã điều chỉnh kho', { description: `${item.ingredientName}: ${formatQty(item.quantityInStock)} → ${formatQty(item.quantityInStock + values.quantityChanged)} ${item.unit}` });
      onClose();
    } catch (e) {
      if (isApiError(e) && e.is(API_ERROR_CODES.VERSION_CONFLICT)) {
        // useAdjustInventory đã refetch; đóng form để lần mở sau dùng đúng tồn kho mới.
        toast.error('Dữ liệu đã thay đổi', { description: 'Tồn kho vừa được cập nhật bởi người khác. Vui lòng kiểm tra lại rồi điều chỉnh.' });
        onClose();
        return;
      }
      setServerError(isApiError(e) ? e.message : 'Không thể điều chỉnh kho, vui lòng thử lại');
    }
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Điều chỉnh kho · ${item.ingredientName}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={adjust.isPending}>Huỷ</Button>
          <Button type="submit" form={FORM_ID} loading={adjust.isPending}>Xác nhận điều chỉnh</Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={(e) => void onSubmit(e)} noValidate className="space-y-4">
        <p className="rounded-md bg-gray-50 px-3 py-2 text-body text-gray-700">
          Tồn kho hiện tại: <strong className="tabular-nums">{formatQty(item.quantityInStock)} {item.unit}</strong>
        </p>

        {serverError && (
          <p role="alert" className="rounded-md border border-error/30 bg-error-soft px-3 py-2 text-body text-error-strong">{serverError}</p>
        )}

        <fieldset className="space-y-2">
          <legend className="text-body font-medium text-gray-800">Loại điều chỉnh</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {ADJUST_TYPE_OPTIONS.map((o) => (
              <label
                key={o.value}
                className={cn(
                  'flex cursor-pointer items-center justify-center rounded-md border px-3 py-2 text-body font-medium transition-colors',
                  type === o.value ? 'border-primary-600 bg-primary-50 text-primary-800' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
                )}
              >
                <input type="radio" value={o.value} className="sr-only" {...register('transactionType')} />
                {o.label}
              </label>
            ))}
          </div>
        </fieldset>

        <Input
          label={`Số lượng thay đổi (${item.unit})`}
          type="number"
          inputMode="decimal"
          step="any"
          hint={hint}
          error={errors.quantityChanged?.message}
          {...register('quantityChanged', { valueAsNumber: true })}
        />
        {after !== null && (
          <p className={cn('text-caption', after < 0 ? 'text-error-strong' : 'text-gray-500')}>
            Tồn kho sau điều chỉnh: {formatQty(after)} {item.unit}
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="adjust-reason" className="text-body font-medium text-gray-800">Lý do (bắt buộc)</label>
          <textarea
            id="adjust-reason"
            rows={3}
            maxLength={255}
            placeholder="Ví dụ: Kiểm kê cuối ngày, hao hụt khi pha chế…"
            aria-invalid={!!errors.reason || undefined}
            aria-describedby={errors.reason ? 'adjust-reason-error' : undefined}
            className={cn(
              'w-full rounded-md border bg-white px-3 py-2 text-body text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2',
              errors.reason ? 'border-error focus:border-error focus:ring-error-soft' : 'border-gray-300 focus:border-primary-500 focus:ring-primary-200',
            )}
            {...register('reason')}
          />
          {errors.reason && <p id="adjust-reason-error" className="text-caption text-error-strong">{errors.reason.message}</p>}
        </div>
      </form>
    </Modal>
  );
}

import { useState } from "react";
import { AlertCircle, Coffee, CreditCard, Store, UtensilsCrossed } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { PATHS, to } from "@/app/routes";
import { cn } from "@/shared/lib/cn";
import { formatVnd } from "@/shared/lib";
import { Button } from "@/shared/ui";
import { calcSubTotal, countItems, describeLine, lineTotal, lineUnitTotal } from "../cart";
import { PageHeader } from "../components/PageHeader";
import { StickyActionBar } from "../components/StickyActionBar";
import { useSubmitDineInOrder } from "../hooks/useSubmitOrder";
import { useDineInCartStore } from "../store";
import { MAX_NOTE_LENGTH } from "../submit";
import { useStartOnlinePayment } from "@/features/payment/hooks/useStartOnlinePayment";

type PayChoice = "counter" | "online";

/**
 * Xác nhận đặt món: tóm tắt đơn → chọn thanh toán → gửi đơn →
 * tại quầy: màn QR thanh toán tại quầy; online: cổng thanh toán giả lập (VNPay mock).
 */
export default function DineInCheckoutPage() {
  const lines = useDineInCartStore((s) => s.lines);
  const tableCode = useDineInCartStore((s) => s.tableCode);
  const sessionId = useDineInCartStore((s) => s.tableSessionId);
  const navigate = useNavigate();
  const sessionCode = useDineInCartStore((s) => s.sessionCode);
  const { submit, isSubmitting, error } = useSubmitDineInOrder();
  const online = useStartOnlinePayment();

  const [payChoice, setPayChoice] = useState<PayChoice>("counter");
  const [note, setNote] = useState("");
  // Sau khi đặt thành công giỏ bị xoá → giữ trang trống thay vì nháy "giỏ trống" trước khi chuyển trang.
  const [done, setDone] = useState(false);

  const subTotal = calcSubTotal(lines);

  async function onConfirm() {
    const order = await submit(note);
    if (!order) return;
    setDone(true);
    if (payChoice === "online") {
      const started = await online.start(order.id, sessionCode);
      if (started.path) {
        navigate(started.path, { replace: true });
        return;
      }
      // Đơn đã được đặt nhưng chưa tạo được giao dịch online → sang màn quầy, nơi khách thử lại online hoặc trả tại quầy.
      navigate(to.counterPayment(String(order.id)), { replace: true, state: { onlineError: started.error } });
      return;
    }
    navigate(to.counterPayment(String(order.id)), { replace: true });
  }

  if (done) return null;

  if (lines.length === 0 || sessionId === null) {
    return (
      <div className="min-h-screen bg-primary-50">
        <PageHeader title="Xác nhận đặt món" back={PATHS.cart} />
        <div className="flex flex-col items-center gap-3 px-6 py-20 text-center">
          <h2 className="text-h4">Chưa có món để đặt</h2>
          <p className="text-body text-gray-600">Giỏ hàng đang trống hoặc phiên bàn đã kết thúc.</p>
          <Link
            to={tableCode ? to.dineInTable(tableCode) : PATHS.start}
            className="inline-flex h-10 items-center rounded-md bg-primary-600 px-4 text-body font-medium text-white hover:bg-primary-700"
          >
            {tableCode ? "Quay lại thực đơn" : "Bắt đầu đặt món"}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-primary-50">
      <PageHeader title="Xác nhận đặt món" back />

      <div className="space-y-5 px-4 pb-44 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-h4 text-primary-700">
            <UtensilsCrossed className="size-5" aria-hidden />
            {tableCode ?? "Bàn"}
          </div>
          <span className="rounded-full bg-primary-100 px-3 py-1 text-caption font-medium text-primary-800">Tại quán</span>
        </div>

        <section aria-labelledby="summary-title">
          <h2 id="summary-title" className="mb-2 text-body-lg font-semibold">
            Tóm tắt đơn hàng · {countItems(lines)} món
          </h2>
          <div className="rounded-lg border border-primary-100 bg-white p-3">
            <ul className="divide-y divide-gray-100">
              {lines.map((l) => (
                <li key={l.key} className="flex gap-3 py-3 first:pt-0">
                  <div className="size-14 shrink-0 overflow-hidden rounded-md bg-primary-50">
                    {l.image ? (
                      <img src={l.image} alt="" className="size-full object-cover" />
                    ) : (
                      <div className="flex size-full items-center justify-center text-primary-300" aria-hidden>
                        <Coffee className="size-5" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between gap-2">
                      <span className="font-semibold text-gray-900">{l.productName}</span>
                      <span className="font-semibold text-primary-600">{formatVnd(lineTotal(l))}</span>
                    </div>
                    <div className="flex justify-between gap-2 text-caption text-gray-500">
                      <span>{describeLine(l) || formatVnd(lineUnitTotal(l))}</span>
                      <span>×{l.quantity}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <dl className="mt-1 space-y-1.5 border-t border-gray-100 pt-3 text-body">
              <div className="flex justify-between text-gray-600">
                <dt>Tạm tính</dt>
                <dd className="font-medium text-gray-900">{formatVnd(subTotal)}</dd>
              </div>
              <div className="flex justify-between text-body-lg font-semibold">
                <dt>Tổng cộng</dt>
                <dd className="text-primary-600">{formatVnd(subTotal)}</dd>
              </div>
            </dl>
          </div>
        </section>

        <fieldset>
          <legend className="mb-2 text-body-lg font-semibold">Phương thức thanh toán</legend>
          <div className="space-y-3">
            <label
              className={cn(
                "flex cursor-pointer items-center justify-between rounded-lg border bg-white px-4 py-3.5",
                payChoice === "online" ? "border-primary-600 ring-1 ring-primary-600" : "border-gray-200",
              )}
            >
              <span className="flex items-center gap-3 font-medium text-gray-900">
                <CreditCard className="size-5 text-primary-600" aria-hidden />
                Thanh toán online
              </span>
              <input
                type="radio"
                name="payment"
                value="online"
                checked={payChoice === "online"}
                onChange={() => setPayChoice("online")}
                className="accent-primary-600"
              />
            </label>
            <label
              className={cn(
                "flex cursor-pointer items-center justify-between rounded-lg border bg-white px-4 py-3.5",
                payChoice === "counter" ? "border-primary-600 ring-1 ring-primary-600" : "border-gray-200",
              )}
            >
              <span className="flex items-center gap-3 font-medium text-gray-900">
                <Store className="size-5 text-primary-600" aria-hidden />
                Thanh toán tại quầy
              </span>
              <input
                type="radio"
                name="payment"
                value="counter"
                checked={payChoice === "counter"}
                onChange={() => setPayChoice("counter")}
                className="accent-primary-600"
              />
            </label>
          </div>
          <p className="mt-2 text-caption text-gray-600">
            {payChoice === "online"
              ? "Sau khi đặt món, bạn được chuyển sang cổng thanh toán VNPay (giả lập) để trả tiền ngay."
              : "Mã QR của đơn sẽ hiển thị để bạn đưa cho thu ngân tại quầy."}
          </p>
        </fieldset>

        <div>
          <label htmlFor="order-note" className="mb-2 block text-body-lg font-semibold">
            Ghi chú món <span className="font-normal text-gray-500">(tùy chọn)</span>
          </label>
          <textarea
            id="order-note"
            value={note}
            maxLength={MAX_NOTE_LENGTH}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ví dụ: Ít ngọt, ít đá…"
            rows={3}
            className="w-full resize-none rounded-lg border border-primary-100 bg-white px-4 py-3 text-body placeholder:text-gray-400 focus:border-primary-600"
          />
        </div>

        {error && (
          <div role="alert" className="flex gap-2 rounded-lg border border-error/30 bg-error-soft p-3 text-body text-error-strong">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div>
              <p className="font-medium">Chưa thể gửi đơn</p>
              <p>{error.message}</p>
              {error.retryable ? (
                <p className="mt-1">Giỏ hàng vẫn được giữ nguyên, bạn có thể bấm xác nhận lại.</p>
              ) : (
                <p className="mt-1">
                  <Link to={PATHS.cart} className="font-medium underline">
                    Kiểm tra lại giỏ hàng
                  </Link>
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <StickyActionBar total={formatVnd(subTotal)}>
        <Button size="lg" loading={isSubmitting || online.isStarting} onClick={() => void onConfirm()}>
          {isSubmitting
            ? "Đang gửi đơn…"
            : online.isStarting
              ? "Đang mở cổng thanh toán…"
              : error?.retryable
                ? "Thử lại"
                : payChoice === "online"
                  ? "Đặt món & thanh toán online"
                  : "Xác nhận đặt món"}
        </Button>
      </StickyActionBar>
    </div>
  );
}

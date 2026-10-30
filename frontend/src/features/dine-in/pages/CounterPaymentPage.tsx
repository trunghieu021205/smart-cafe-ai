import { AlertCircle, CheckCircle2, Clock, CreditCard, Info } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { PATHS, to } from "@/app/routes";
import { formatVnd } from "@/shared/lib";
import { Button } from "@/shared/ui";
import { useStartOnlinePayment } from "@/features/payment/hooks/useStartOnlinePayment";
import { PageHeader } from "../components/PageHeader";
import { placedOrderMeta, usePlacedOrders } from "../placed-orders";
import { useDineInCartStore } from "../store";

/**
 * Màn xác nhận sau khi đặt món: mã đơn + QR để đưa thu ngân.
 * Chỉ ĐỌC đơn đã lưu lúc đặt (không POST) nên F5 không bao giờ tạo thêm đơn.
 * Không có theo dõi trạng thái đơn cho khách (đúng phạm vi Dine-in).
 */
export default function CounterPaymentPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const order = usePlacedOrders((s) => s.orders.find((o) => String(o.id) === orderId));
  const storeTableCode = useDineInCartStore((s) => s.tableCode);
  const navigate = useNavigate();
  const location = useLocation();
  const online = useStartOnlinePayment();
  const meta = order ? placedOrderMeta(order.id) : {};
  const tableCode = meta.tableCode ?? storeTableCode;
  // Lỗi tạo giao dịch online ngay sau khi đặt món (do trang checkout chuyển sang): đơn đã đặt, khách chọn lại cách trả.
  const handoffError = (location.state as { onlineError?: unknown } | null)?.onlineError;
  const onlineError = online.error ?? (typeof handoffError === "string" ? handoffError : null);

  async function switchToOnline() {
    if (!order) return;
    const started = await online.start(order.id, meta.sessionCode);
    if (started.path) navigate(started.path);
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-primary-50">
        <PageHeader title="Đơn hàng" />
        <div className="flex flex-col items-center gap-3 px-6 py-20 text-center">
          <h2 className="text-h4">Không tìm thấy đơn trên thiết bị này</h2>
          <p className="text-body text-gray-600">
            Nếu bạn vừa đặt món, vui lòng báo mã đơn cho nhân viên. Bạn cũng có thể quét lại mã QR trên bàn để gọi thêm.
          </p>
          <Link to={PATHS.start} className="font-medium text-primary-600 underline">
            Về trang bắt đầu
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-2xl bg-primary-50 pb-10">
      <PageHeader title="Thanh toán tại quầy" />

      <div className="space-y-4 px-4 pt-6 text-center">
        <p className="inline-flex items-center gap-1.5 text-body font-medium text-success-strong">
          <CheckCircle2 className="size-4" aria-hidden /> Đặt món thành công
        </p>
        <h2 className="font-heading text-h1 text-gray-900">#{order.orderCode}</h2>
        <p className="text-body text-gray-600">
          {order.tableNumber ? `Bàn ${order.tableNumber}` : "Tại quán"} · Thanh toán tại quầy
        </p>
        <span className="inline-flex items-center gap-2 rounded-full bg-primary-100 px-3 py-1 text-caption font-medium text-primary-800">
          <span className="size-1.5 rounded-full bg-accent-500" aria-hidden />
          Chờ thanh toán tại quầy
        </span>

        <section aria-label="Mã QR đơn hàng" className="rounded-xl border border-primary-100 bg-white p-6 shadow-card">
          <div className="mx-auto w-fit rounded-md bg-white p-1">
            <QRCodeSVG
              value={`smartcafe://order/${order.id}`}
              size={208}
              marginSize={1}
              role="img"
              title={`Mã QR của đơn ${order.orderCode}`}
            />
          </div>
          <p className="mt-4 font-heading text-h2 text-primary-600">{formatVnd(order.finalAmount)}</p>
          <p className="mt-1 text-caption text-gray-600">Đưa mã QR này cho thu ngân để thanh toán.</p>
        </section>

        <div className="flex items-start gap-2 rounded-lg border border-primary-100 bg-white p-3 text-left text-body text-gray-700">
          <Info className="mt-0.5 size-4 shrink-0 text-primary-600" aria-hidden />
          <p>
            Nếu không quét được, đọc mã đơn <strong>{order.orderCode}</strong> cho thu ngân.
          </p>
        </div>

        <section aria-label="Trả online" className="space-y-2 rounded-lg border border-primary-100 bg-white p-4 text-left">
          <p className="text-body text-gray-700">Không muốn chờ ở quầy? Bạn có thể trả ngay bằng cổng thanh toán online.</p>
          {onlineError && (
            <p role="alert" className="flex items-start gap-2 text-body font-medium text-error-strong">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {onlineError}
            </p>
          )}
          <Button variant="outline" size="lg" fullWidth loading={online.isStarting} leftIcon={<CreditCard className="size-5" aria-hidden />} onClick={() => void switchToOnline()}>
            Chuyển sang trả online
          </Button>
        </section>

        <section aria-label="Món đã đặt" className="rounded-lg border border-primary-100 bg-white p-4 text-left">
          <h3 className="mb-2 flex items-center gap-2 text-body font-semibold">
            <Clock className="size-4 text-primary-600" aria-hidden />
            Món đã đặt · {order.items.reduce((n, i) => n + i.quantity, 0)} món
          </h3>
          <ul className="divide-y divide-gray-100 text-body">
            {order.items.map((i) => (
              <li key={i.id} className="flex justify-between gap-3 py-2">
                <span>
                  {i.quantity}× {i.productName}
                  <span className="block text-caption text-gray-500">
                    {[i.variantName !== "Standard" ? `Size ${i.variantName}` : null, ...i.options.map((o) => o.optionName)]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                </span>
                <span className="font-medium">{formatVnd(i.lineTotal)}</span>
              </li>
            ))}
          </ul>
        </section>

        <Link
          to={tableCode ? to.dineInTable(tableCode) : PATHS.start}
          className="flex h-12 w-full items-center justify-center rounded-md bg-primary-600 font-medium text-white hover:bg-primary-700"
        >
          Gọi thêm món
        </Link>
      </div>
    </div>
  );
}

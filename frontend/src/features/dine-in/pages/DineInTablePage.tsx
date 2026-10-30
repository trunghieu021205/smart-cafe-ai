import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { isApiError } from "@/shared/api";
import { PATHS } from "@/app/routes";
import { formatVnd } from "@/shared/lib";
import type { MenuProduct } from "@/shared/types";
import { Badge, Button, Skeleton } from "@/shared/ui";
import { calcSubTotal, countItems } from "../cart";
import { CartDrawer } from "../components/CartDrawer";
import { CategoryTabs } from "../components/CategoryTabs";
import { ProductCard } from "../components/ProductCard";
import { ProductOptionsModal } from "../components/ProductOptionsModal";
import { StateMessage } from "../components/StateMessage";
import { DINE_IN_BRANCH_ID } from "../config";
import { useCategories, useMenuProducts } from "../hooks/useMenu";
import { useTableSession } from "../hooks/useTableSession";
import { useOnlineCartStore } from "@/features/online-order/store";
import { useDineInCartStore } from "../store";
import { isValidTableCode } from "../validators";

const BackToStart = () => (
  <Link to={PATHS.start} className="text-body font-medium text-primary-600 underline">
    Về trang chọn hình thức đặt món
  </Link>
);

/** QR Ordering Page: mở phiên bàn → menu theo danh mục → giỏ hàng (Zustand). Gửi đơn ở trang checkout. */
export default function DineInTablePage() {
  const { tableCode } = useParams<{ tableCode: string }>();
  const session = useTableSession(tableCode);
  const bindSession = useDineInCartStore((s) => s.bindSession);
  const boundSessionId = useDineInCartStore((s) => s.tableSessionId);

  const sessionId = session.data?.id;
  const sessionCode = session.data?.sessionCode;
  useEffect(() => {
    if (sessionId !== undefined) {
      bindSession(sessionId, tableCode, sessionCode);
      // Đã ngồi vào bàn thì giỏ hiện hành là giỏ Dine-in (giỏ Online giữ nguyên nhưng không còn là chế độ đang dùng).
      useOnlineCartStore.getState().setFulfillment(null);
    }
  }, [sessionId, sessionCode, tableCode, bindSession]);

  if (!isValidTableCode(tableCode)) {
    return (
      <Shell>
        <StateMessage title="Mã bàn không hợp lệ" action={<BackToStart />}>
          Vui lòng quét lại mã QR trên bàn hoặc nhập lại mã bàn.
        </StateMessage>
      </Shell>
    );
  }

  if (session.isPending) {
    return (
      <Shell>
        <div className="space-y-3 p-4" aria-busy aria-label="Đang mở bàn">
          <Skeleton className="h-10" />
          <div className="grid grid-cols-2 gap-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-48" />
            ))}
          </div>
        </div>
      </Shell>
    );
  }

  if (session.isError) {
    const err = session.error;
    const retryable = !isApiError(err) || err.status === 0 || err.status >= 500;
    return (
      <Shell>
        <StateMessage
          title={isApiError(err) && err.is("TABLE_NOT_FOUND") ? "Không nhận diện được mã bàn" : "Không thể mở bàn"}
          action={
            retryable ? (
              <Button variant="outline" onClick={() => void session.refetch()}>
                Thử lại
              </Button>
            ) : (
              <BackToStart />
            )
          }
        >
          {isApiError(err) ? err.message : "Đã có lỗi xảy ra. Vui lòng thử lại."}
        </StateMessage>
      </Shell>
    );
  }

  if (session.data.status !== "Active") {
    return (
      <Shell>
        <StateMessage title="Phiên bàn đã kết thúc" action={<BackToStart />}>
          Vui lòng quét lại mã QR trên bàn để bắt đầu gọi món.
        </StateMessage>
      </Shell>
    );
  }

  // Chờ effect gắn phiên → không bao giờ hiện giỏ của phiên khác dù chỉ 1 frame.
  if (boundSessionId !== session.data.id) {
    return (
      <Shell>
        <Skeleton className="m-4 h-10" />
      </Shell>
    );
  }

  return (
    <Shell>
      <MenuView />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto min-h-screen max-w-2xl bg-gray-50">{children}</div>;
}

function MenuView() {
  const categories = useCategories();
  const products = useMenuProducts(DINE_IN_BRANCH_ID);
  const lines = useDineInCartStore((s) => s.lines);
  const addLine = useDineInCartStore((s) => s.addLine);

  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [picking, setPicking] = useState<MenuProduct | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const navigate = useNavigate();

  const itemCount = countItems(lines);
  const visible = (products.data ?? []).filter(
    (p) => p.price !== null && (categoryId === null || p.categoryId === categoryId),
  );

  return (
    <>
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <Badge tone="primary">Tại bàn</Badge>
          <span className="text-body text-gray-600">Smart Cafe QR Ordering</span>
        </div>
      </header>

      {categories.data && <CategoryTabs categories={categories.data} activeId={categoryId} onChange={setCategoryId} />}
      {categories.isError && (
        <p className="px-4 py-3 text-caption text-gray-500">Không tải được danh mục, đang hiển thị tất cả món.</p>
      )}

      <section className="px-4 pb-32" aria-label="Thực đơn">
        {products.isPending && (
          <div className="grid grid-cols-2 gap-3" aria-busy>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-48" />
            ))}
          </div>
        )}
        {products.isError && (
          <StateMessage
            title="Không tải được thực đơn"
            action={
              <Button variant="outline" onClick={() => void products.refetch()}>
                Thử lại
              </Button>
            }
          >
            {isApiError(products.error) ? products.error.message : "Vui lòng thử lại."}
          </StateMessage>
        )}
        {products.isSuccess && visible.length === 0 && (
          <StateMessage title="Chưa có món nào">Danh mục này hiện chưa có món để gọi.</StateMessage>
        )}
        {visible.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {visible.map((p) => (
              <ProductCard key={p.id} product={p} onAdd={setPicking} />
            ))}
          </div>
        )}
      </section>

      {itemCount > 0 && (
        <div
          className="fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-2xl items-center justify-between gap-3 border-t border-gray-200 bg-white px-4 py-3"
          style={{ paddingBottom: "max(0.75rem, var(--safe-bottom, 0px))" }}
        >
          <div>
            <div className="text-caption text-gray-500">{itemCount} sản phẩm đã chọn</div>
            <div className="text-h4 text-primary-600">{formatVnd(calcSubTotal(lines))}</div>
          </div>
          <Button size="lg" onClick={() => setCartOpen(true)}>
            Xem giỏ hàng
          </Button>
        </div>
      )}

      <ProductOptionsModal
        product={picking}
        onClose={() => setPicking(null)}
        onAdd={(line, quantity) => {
          addLine(line, quantity);
          setPicking(null);
        }}
      />
      <CartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        onCheckout={() => navigate(PATHS.dineInCheckout)}
      />
    </>
  );
}

// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { usePlacedOrders } from '@/features/dine-in/placed-orders';
import { useDineInCartStore } from '@/features/dine-in/store';
import { cashierGroup } from '@/features/cashier/model';
import { db } from '@/mocks/db';
import { handlers } from '@/mocks/handlers';
import { url } from '@/mocks/utils';
import { orderApi, paymentApi, storeApi } from '@/shared/api';
import { formatVnd } from '@/shared/lib';
import type { OrderDetail } from '@/shared/types';
import { latte, loginAs, resetWorld, TABLE_CODE } from '@/test/helpers';
import { polyfillDialog, renderApp } from '@/test/renderApp';
import PaymentGatewayPage from './pages/PaymentGatewayPage';

const server = setupServer(...handlers);
beforeAll(() => {
  server.listen();
  polyfillDialog();
});
afterAll(() => server.close());
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
beforeEach(resetWorld);

/** Khách quét QR bàn, bỏ 2 ly vào giỏ rồi tới trang xác nhận đặt món (không đăng nhập). */
async function arrive() {
  const r = renderApp(`/dine-in/table/${TABLE_CODE}`);
  await screen.findByText('Smart Cafe QR Ordering');
  await waitFor(() => expect(useDineInCartStore.getState().sessionCode).not.toBeNull());
  act(() => useDineInCartStore.getState().addLine(latte, 2));
  await act(() => r.router.navigate('/dine-in/checkout'));
  return r;
}

async function chooseOnlineAndOrder() {
  const r = await arrive();
  fireEvent.click(await screen.findByRole('radio', { name: /Thanh toán online/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Đặt món & thanh toán online' }));
  await waitFor(() => expect(r.router.state.location.pathname).toMatch(/^\/payment\/\d+$/));
  await screen.findByRole('button', { name: 'Thanh toán thành công' });
  return r;
}

describe('Dine-in checkout → cổng thanh toán giả lập', () => {
  it('guest chọn Online → đặt món → cổng (không bottom-nav, không bị đưa tới /login) → "Thành công" → Thu ngân thấy "Đã trả online"', async () => {
    const { router, unmount } = await chooseOnlineAndOrder();

    const order = db.orders[0]!;
    expect(router.state.location.search).toBe(`?paymentId=${db.payments[0]!.id}`);
    expect(screen.getByText('#SC00001')).toBeTruthy();
    expect(screen.getByText(formatVnd(order.finalAmount))).toBeTruthy();
    expect(screen.getByLabelText('thời gian còn lại').textContent).toMatch(/^1[45]:\d\d$/); // đếm ngược TTL ~15 phút
    expect(screen.queryByRole('navigation', { name: 'Điều hướng chính' })).toBeNull(); // cổng nằm ngoài CustomerLayout
    expect(order.paymentStatus).toBe('Unpaid'); // trang chưa chốt gì: IPN mới là nguồn sự thật

    fireEvent.click(screen.getByRole('button', { name: 'Thanh toán thành công' }));
    expect((await screen.findAllByText('Thanh toán thành công')).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Về thực đơn bàn' }).getAttribute('href')).toBe(`/dine-in/table/${TABLE_CODE}`);
    expect(router.state.location.pathname).toMatch(/^\/payment\/\d+$/);
    expect(db.orders[0]).toMatchObject({ paymentStatus: 'Paid', paidOnline: true });
    expect(db.invoices).toHaveLength(1);
    expect(db.orders).toHaveLength(1);

    // F5 ở trang kết quả vẫn thấy thành công (dữ liệu từ giao dịch, không tạo gì mới)
    const path = router.state.location.pathname + router.state.location.search;
    unmount();
    renderApp(path);
    expect(await screen.findByRole('link', { name: 'Về thực đơn bàn' })).toBeTruthy();
    expect(db.payments).toHaveLength(1);
    cleanup();

    // Staff: đơn nằm ở "Đã trả online", không còn ở "Chờ thu tại quầy"
    expect(cashierGroup(db.orders[0]!)).toBe('paid_online');
    loginAs('Staff');
    renderApp('/staff?tab=cashier');
    const online = await screen.findByRole('region', { name: 'Đã trả online' });
    expect(await within(online).findByText(/#SC00001/)).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Chờ thu tại quầy' })).queryByText(/#SC00001/)).toBeNull();
  });

  it('"Thất bại" → Thử lại / Chuyển sang trả tại quầy (QR quầy) → "Chuyển sang trả online" tạo lại giao dịch; đơn luôn Unpaid', async () => {
    const { router } = await chooseOnlineAndOrder();
    const firstPaymentId = db.payments[0]!.id;

    fireEvent.click(screen.getByRole('button', { name: 'Thanh toán thất bại' }));
    expect(await screen.findByText('Thanh toán thất bại', { selector: 'h2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeTruthy();
    expect(db.orders[0]!.paymentStatus).toBe('Unpaid');

    fireEvent.click(screen.getByRole('link', { name: 'Chuyển sang trả tại quầy' }));
    expect(await screen.findByRole('img', { name: /Mã QR của đơn SC00001/ })).toBeTruthy();
    expect(router.state.location.pathname).toMatch(/^\/dine-in\/pay\/counter\/\d+$/);

    fireEvent.click(screen.getByRole('button', { name: 'Chuyển sang trả online' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/payment\/\d+$/));
    expect(await screen.findByRole('button', { name: 'Thanh toán thành công' })).toBeTruthy();
    expect(db.payments).toHaveLength(2);
    expect(router.state.location.search).toBe(`?paymentId=${db.payments[1]!.id}`);
    expect(db.payments[1]!.id).not.toBe(firstPaymentId);
    expect(db.orders).toHaveLength(1); // chưa bao giờ tạo thêm đơn
  });

  it('"Thử lại" ở trang thất bại tạo giao dịch mới cho cùng đơn', async () => {
    const { router } = await chooseOnlineAndOrder();
    fireEvent.click(screen.getByRole('button', { name: 'Hết hạn' }));
    expect(await screen.findByText('Giao dịch đã hết hạn')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('button', { name: 'Thanh toán thành công' })).toBeTruthy();
    expect(db.payments.map((p) => p.status)).toEqual(['Expired', 'Pending']);
    expect(router.state.location.search).toBe(`?paymentId=${db.payments[1]!.id}`);
    expect(db.orders).toHaveLength(1);
  });

  it('chọn "Tại quầy" (mặc định) giữ nguyên hành vi cũ: sang QR quầy, không tạo payment', async () => {
    const { router } = await arrive();
    expect((screen.getByRole('radio', { name: /Thanh toán tại quầy/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đặt món' }));
    expect(await screen.findByRole('img', { name: /Mã QR của đơn SC00001/ })).toBeTruthy();
    expect(router.state.location.pathname).toMatch(/^\/dine-in\/pay\/counter\/\d+$/);
    expect(db.payments).toHaveLength(0);
  });
});

describe('PaymentGatewayPage — polling và các trạng thái', () => {
  async function pendingPayment() {
    const session = await storeApi.openTableSession({ qrCode: TABLE_CODE });
    const order: OrderDetail = await orderApi.createOrder({
      orderSource: 'QR', fulfillmentType: 'Dine_In', branchId: 1, tableSessionId: session.id,
      lines: [{ variantId: 12, quantity: 1, options: [{ optionId: 101 }, { optionId: 104 }] }],
    });
    usePlacedOrders.getState().record(order, { sessionCode: session.sessionCode, tableCode: TABLE_CODE });
    const res = await paymentApi.payOrders({ orderIds: [order.id], method: 'VNPay' }, { sessionCode: session.sessionCode });
    return { order, session, paymentId: res.payment.id };
  }

  const renderGateway = (path: string, pollMs = 30) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/payment/:orderId" element={<PaymentGatewayPage pollMs={pollMs} />} />
            <Route path="*" element={<p>route khác</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  };

  it('render thông tin đơn rồi tự chuyển sang thành công khi payment Success (IPN từ nơi khác, trang chỉ polling)', async () => {
    const { order, session, paymentId } = await pendingPayment();
    renderGateway(`/payment/${order.id}?paymentId=${paymentId}`);

    expect(await screen.findByText(`#${order.orderCode}`)).toBeTruthy();
    expect(screen.getByText(formatVnd(order.finalAmount))).toBeTruthy();
    for (const name of ['Thanh toán thành công', 'Thanh toán thất bại', 'Hết hạn']) expect(screen.getByRole('button', { name })).toBeTruthy();

    await paymentApi.simulatePayment(paymentId, { result: 'success' }, { sessionCode: session.sessionCode }); // IPN
    expect(await screen.findByRole('link', { name: 'Về thực đơn bàn' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Thanh toán thất bại' })).toBeNull();
  });

  it('đơn đã thanh toán ở quầy trong lúc chờ → "Đã thanh toán", không cho thanh toán lại', async () => {
    const { order, paymentId } = await pendingPayment();
    await paymentApi.payOrders({ orderIds: [order.id], method: 'Cash', cashReceived: order.finalAmount });
    renderGateway(`/payment/${order.id}?paymentId=${paymentId}`);
    expect(await screen.findByText('Đơn này đã được thanh toán')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Thanh toán thành công' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
  });

  it('gõ thẳng URL với orderId/paymentId lạ hoặc thiếu → trạng thái lỗi rõ ràng, không treo', async () => {
    renderGateway('/payment/999?paymentId=999');
    expect((await screen.findByRole('alert')).textContent).toContain('Không mở được giao dịch');
    cleanup();

    renderGateway('/payment/999');
    expect((await screen.findByRole('alert')).textContent).toContain('Không tìm thấy giao dịch');
    cleanup();

    renderGateway('/payment/abc?paymentId=1');
    expect((await screen.findByRole('alert')).textContent).toContain('Không tìm thấy giao dịch');
  });

  it('giao dịch của đơn khác (orderId trên URL không khớp) → báo không thuộc đơn này', async () => {
    const { order, paymentId } = await pendingPayment();
    renderGateway(`/payment/${order.id + 1}?paymentId=${paymentId}`);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Giao dịch không thuộc đơn này|Không mở được giao dịch/);
  });

  it('mất kết nối: báo Mất kết nối + Thử lại; có mạng lại thì mở được', async () => {
    const { order, paymentId } = await pendingPayment();
    server.use(http.get(url('/payment/payments/:id'), () => HttpResponse.error(), { once: true }));
    renderGateway(`/payment/${order.id}?paymentId=${paymentId}`);
    expect(await screen.findByText('Mất kết nối')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('button', { name: 'Thanh toán thành công' })).toBeTruthy();
  });
});


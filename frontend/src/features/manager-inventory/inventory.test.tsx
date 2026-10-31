// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '@/features/auth/store';
import { db } from '@/mocks/db';
import { handlers } from '@/mocks/handlers';
import { MOCK_PASSWORD, resetAuthMock } from '@/mocks/handlers/identity';
import { url } from '@/mocks/utils';
import { configureHttp, identityApi } from '@/shared/api';
import { resetWorld } from '@/test/helpers';
import { polyfillDialog, renderApp } from '@/test/renderApp';

const server = setupServer(...handlers);
beforeAll(() => {
  server.listen();
  polyfillDialog();
  configureHttp({ getToken: () => useAuthStore.getState().accessToken });
});
afterAll(() => server.close());
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
beforeEach(async () => {
  resetWorld();
  resetAuthMock();
  // Đăng nhập Manager THẬT qua mock identity để token được handler kho chấp nhận.
  const session = await identityApi.login({ identifier: 'manager@smartcafe.vn', password: MOCK_PASSWORD });
  useAuthStore.getState().applySession(session);
});

const stockOf = (ingredientId: number) => db.inventory.find((r) => r.ingredientId === ingredientId)!;

/** <dialog> của Modal dùng chung không có aria-labelledby → tìm theo tiêu đề rồi lấy phần tử <dialog> chứa nó. */
async function findAdjustModal(): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name: /^Điều chỉnh kho · / });
  return heading.closest('dialog') as HTMLElement;
}

async function openDrawer(name: string) {
  const table = await screen.findByRole('table');
  fireEvent.click(within(table).getByRole('button', { name }));
  return screen.findByRole('dialog', { name });
}

describe('/manager/inventory', () => {
  it('hiển thị bảng với badge trạng thái và làm nổi bật hàng sắp hết / hết', async () => {
    renderApp('/manager/inventory');
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(13); // header + 12 nguyên liệu
    const rowOf = (name: string) => within(table).getByRole('button', { name }).closest('tr') as HTMLElement;
    expect(within(rowOf('Trân châu đen')).getByText('Hết hàng')).toBeTruthy();
    expect(within(rowOf('Cà phê hạt Arabica')).getByText('Sắp hết')).toBeTruthy();
    expect(within(rowOf('Cà phê hạt Robusta')).getByText('Ổn')).toBeTruthy();
    expect(rowOf('Trân châu đen').className).toContain('bg-error-soft');
    expect(rowOf('Cà phê hạt Arabica').className).toContain('bg-warning-soft');
  });

  it('tìm kiếm không dấu, toggle "Sắp hết" và trạng thái không có kết quả', async () => {
    renderApp('/manager/inventory');
    await screen.findByRole('table');

    fireEvent.change(screen.getByLabelText('Tìm nguyên liệu'), { target: { value: 'ca phe' } });
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(3);

    fireEvent.change(screen.getByLabelText('Tìm nguyên liệu'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Sắp hết/ }));
    const lowRows = within(screen.getByRole('table')).getAllByRole('row').length - 1;
    expect(lowRows).toBe(4); // 3 sắp hết + 1 hết

    fireEvent.change(screen.getByLabelText('Tìm nguyên liệu'), { target: { value: 'khong co thu nay' } });
    expect(await screen.findByText('Không tìm thấy nguyên liệu phù hợp')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Xoá bộ lọc' }));
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(13);
  });

  it('drawer: lịch sử log, biểu đồ 7 ngày và lọc theo nhóm nguồn', async () => {
    renderApp('/manager/inventory');
    const drawer = await openDrawer('Cà phê hạt Robusta');
    expect(await within(drawer).findByRole('img', { name: /Tiêu thụ 7 ngày gần nhất/ })).toBeTruthy();
    expect(within(drawer).getByRole('button', { name: /^Tất cả \(/ })).toBeTruthy();

    const manual = within(drawer).getByRole('button', { name: /^Thủ công \(1\)/ });
    fireEvent.click(manual);
    const items = within(drawer).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(within(items[0]).getByText('Kiểm kê')).toBeTruthy();

    fireEvent.click(within(drawer).getByRole('button', { name: /^Nhập hàng \(1\)/ }));
    expect(within(drawer).getAllByRole('listitem')[0].textContent).toContain('Nhập hàng');
  });

  it('điều chỉnh kho thành công: validate lý do, cập nhật bảng, ghi log và tăng version', async () => {
    renderApp('/manager/inventory');
    const drawer = await openDrawer('Cà phê hạt Robusta');
    fireEvent.click(within(drawer).getByRole('button', { name: 'Điều chỉnh kho' }));
    const modal = await findAdjustModal();
    expect(within(modal).getByRole('heading', { name: 'Điều chỉnh kho · Cà phê hạt Robusta' })).toBeTruthy();

    fireEvent.change(within(modal).getByLabelText(/Số lượng thay đổi/), { target: { value: '-500' } });
    fireEvent.click(within(modal).getByRole('button', { name: 'Xác nhận điều chỉnh' }));
    expect(await within(modal).findByText('Vui lòng nhập lý do')).toBeTruthy(); // chưa gọi API
    expect(stockOf(1).quantityInStock).toBe(15000);

    const versionBefore = stockOf(1).version;
    const logsBefore = db.inventoryLogs.length;
    fireEvent.change(within(modal).getByLabelText(/Lý do/), { target: { value: 'Đổ nhầm bao hạt' } });
    fireEvent.click(within(modal).getByRole('button', { name: 'Xác nhận điều chỉnh' }));

    await waitFor(() => expect(stockOf(1).quantityInStock).toBe(14500));
    expect(stockOf(1).version).toBe(versionBefore + 1);
    expect(db.inventoryLogs).toHaveLength(logsBefore + 1);
    expect(await screen.findByText('Đã điều chỉnh kho')).toBeTruthy();
    // Bảng tải lại với số mới
    await waitFor(() => {
      const row = within(screen.getByRole('table')).getByRole('button', { name: 'Cà phê hạt Robusta' }).closest('tr') as HTMLElement;
      expect(row.textContent).toContain('14.500');
    });
  });

  it('Waste phải là số âm: chặn ngay ở form, không gọi API', async () => {
    renderApp('/manager/inventory');
    const drawer = await openDrawer('Sữa đặc');
    fireEvent.click(within(drawer).getByRole('button', { name: 'Điều chỉnh kho' }));
    const modal = await findAdjustModal();
    fireEvent.click(within(modal).getByLabelText('Hao hụt / bỏ đi'));
    fireEvent.change(within(modal).getByLabelText(/Số lượng thay đổi/), { target: { value: '100' } });
    fireEvent.change(within(modal).getByLabelText(/Lý do/), { target: { value: 'Bỏ hộp hỏng' } });
    fireEvent.click(within(modal).getByRole('button', { name: 'Xác nhận điều chỉnh' }));
    expect(await within(modal).findByText('Hao hụt phải là số âm')).toBeTruthy();
    expect(db.inventoryLogs.some((l) => l.transactionType === 'Waste' && l.reason === 'Bỏ hộp hỏng')).toBe(false);
  });

  it('lỗi version (409): toast "Dữ liệu đã thay đổi", tải lại tồn kho và không ghi gì', async () => {
    renderApp('/manager/inventory');
    const drawer = await openDrawer('Cà phê hạt Robusta');
    fireEvent.click(within(drawer).getByRole('button', { name: 'Điều chỉnh kho' }));
    const modal = await findAdjustModal();

    // Người khác sửa kho sau khi form đã mở
    const row = stockOf(1);
    row.quantityInStock -= 1000;
    row.version += 1;
    const logsBefore = db.inventoryLogs.length;

    fireEvent.change(within(modal).getByLabelText(/Số lượng thay đổi/), { target: { value: '-100' } });
    fireEvent.change(within(modal).getByLabelText(/Lý do/), { target: { value: 'Kiểm lại' } });
    fireEvent.click(within(modal).getByRole('button', { name: 'Xác nhận điều chỉnh' }));

    expect(await screen.findByText('Dữ liệu đã thay đổi')).toBeTruthy();
    expect(db.inventoryLogs).toHaveLength(logsBefore);
    expect(row.quantityInStock).toBe(14000);
    await waitFor(() => expect(screen.queryByRole('heading', { name: /^Điều chỉnh kho · / })).toBeNull());
    // Bảng đã refetch → hiển thị số mới do người khác sửa
    await waitFor(() => {
      const tr = within(screen.getByRole('table')).getByRole('button', { name: 'Cà phê hạt Robusta' }).closest('tr') as HTMLElement;
      expect(tr.textContent).toContain('14.000');
    });
  });

  it('trạng thái lỗi có nút "Thử lại" và tải lại được', async () => {
    let fail = true;
    server.use(
      http.get(url('/inventory/stock'), () =>
        fail ? HttpResponse.json({ message: 'Máy chủ bận', code: 'SERVER_BUSY' }, { status: 503 }) : undefined,
      ),
    );
    renderApp('/manager/inventory');
    expect(await screen.findByText('Không tải được dữ liệu kho')).toBeTruthy();
    expect(screen.getByText('Máy chủ bận')).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('table')).toBeTruthy();
  });

  it('kho trống → thông báo empty; đang tải → có skeleton', async () => {
    server.use(http.get(url('/inventory/stock'), () => HttpResponse.json([])));
    renderApp('/manager/inventory');
    expect(screen.getByRole('status', { name: 'Đang tải kho' })).toBeTruthy();
    expect(await screen.findByText('Chưa có nguyên liệu nào trong kho')).toBeTruthy();
  });
});

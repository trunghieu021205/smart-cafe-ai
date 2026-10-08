# THIẾT KẾ NỀN TẢNG AI CHO HỆ THỐNG SMART AI CAFE
### Nghiên cứu & lựa chọn mô hình AI phù hợp cho Chatbot tư vấn, Hệ thống gợi ý món và Trích xuất dữ liệu hóa đơn

---

## 1. TỔNG QUAN BÀI TOÁN

Hệ thống Smart AI Cafe cần giải quyết 3 bài toán AI độc lập nhưng liên kết với nhau trong cùng một nền tảng:

| # | Chức năng | Loại bài toán AI | Input | Output |
|---|-----------|-------------------|-------|--------|
| 1 | Chatbot tư vấn | Xử lý ngôn ngữ tự nhiên (NLP) | Câu hỏi văn bản của khách | Câu trả lời hoặc chuyển tiếp nhân viên |
| 2 | Gợi ý món | Hệ thống đề xuất (Recommender System) | Lịch sử hành vi + dữ liệu món | Danh sách món được xếp hạng |
| 3 | Quét hóa đơn | Thị giác máy tính (Computer Vision) + OCR | Ảnh chụp bill | Bảng dữ liệu Excel có cấu trúc |

Mỗi phần dưới đây trình bày: **cơ sở lý thuyết → cách mô hình hoạt động → phương án áp dụng thực tế vào hệ thống**.

---

## 2. CHATBOX AI TƯ VẤN KHÁCH HÀNG

### 2.1. Cơ sở lý thuyết

Chatbot dạng "trả lời dựa trên kiến thức đã train trước, ngoài phạm vi thì chuyển người thật" thuộc nhóm **Closed-domain, Retrieval-based / Hybrid Chatbot**, khác với chatbot mở (open-domain) như ChatGPT trả lời mọi thứ.

Có 3 hướng tiếp cận lý thuyết chính:

**a) Rule-based / Pattern Matching**
- Dựa trên tập luật if-else, keyword matching (VD: AIML, regex).
- Ưu điểm: đơn giản, dễ kiểm soát nội dung trả lời.
- Nhược điểm: cứng nhắc, không hiểu được câu hỏi diễn đạt khác đi.

**b) Intent Classification (NLU truyền thống)**
- Bài toán phân loại văn bản (Text Classification): với mỗi câu hỏi, mô hình dự đoán **ý định (intent)** trong tập intent đã định nghĩa trước (VD: hỏi giờ mở cửa, hỏi giá món, hỏi khuyến mãi...).
- Quy trình: `Tiền xử lý văn bản → Vector hóa (TF-IDF / Word Embedding) → Mô hình phân loại (SVM, Naive Bayes, hoặc mạng neural nhỏ) → Intent + Entity`.
- Có thêm bước **Entity Recognition (NER)** để trích các thực thể như tên món, số lượng, thời gian.
- Mỗi intent dự đoán kèm theo một **độ tin cậy (confidence score)**. Nếu confidence thấp hơn ngưỡng (VD: < 0.6) → hệ thống coi là "ngoài phạm vi".

**c) Retrieval-Augmented Generation (RAG) — khuyến nghị chính**
- Thay vì train một mô hình sinh câu trả lời từ đầu (tốn dữ liệu, dễ "ảo giác" - hallucination), RAG kết hợp:
  1. **Retriever**: tìm đoạn kiến thức liên quan nhất trong cơ sở dữ liệu tri thức (FAQ, menu, chính sách quán) bằng cách so khớp vector ngữ nghĩa (semantic embedding, ví dụ dùng cosine similarity giữa embedding câu hỏi và embedding tài liệu).
  2. **Generator**: một mô hình ngôn ngữ (LLM) dùng đoạn kiến thức tìm được để soạn câu trả lời tự nhiên, thay vì trả lời tự do.
- Ưu điểm so với train mô hình từ đầu: không cần huấn luyện lại khi menu/chính sách thay đổi — chỉ cần cập nhật kho tri thức (knowledge base).
- Đây là kỹ thuật phù hợp nhất cho use case "trả lời dựa trên lý thuyết đã train trước, có phạm vi rõ ràng".

### 2.2. Cách mô hình hoạt động (pipeline đề xuất)

```
Câu hỏi khách hàng
      │
      ▼
Tiền xử lý (chuẩn hóa, tách từ tiếng Việt - dùng thư viện như underthesea/pyvi)
      │
      ▼
Sinh embedding câu hỏi (Sentence Embedding)
      │
      ▼
So khớp với kho tri thức (Vector Database: FAISS / Chroma / Pinecone)
      │
      ├── Tìm thấy đoạn liên quan, độ tương đồng ≥ ngưỡng
      │         │
      │         ▼
      │   LLM sinh câu trả lời dựa trên đoạn tìm được → trả lời khách
      │
      └── Không tìm thấy / độ tương đồng < ngưỡng
                │
                ▼
        Hiển thị: "Câu hỏi này ngoài phạm vi hỗ trợ của AI"
        + Nút "Nhân viên tư vấn trực tuyến" (chuyển sang live chat với người thật)
```

**Cơ chế fallback:**
- Đặt ngưỡng tin cậy (confidence threshold) cho cả bước retrieval lẫn bước intent classification.
- Nếu dưới ngưỡng → không đoán bừa, trả lời rõ ràng là ngoài phạm vi + gợi ý chuyển nhân viên thật (tránh chatbot "bịa" thông tin sai gây mất uy tín quán).
- Log lại các câu hỏi bị fallback → đây là nguồn dữ liệu quý để mở rộng kho tri thức theo thời gian (continuous learning theo hướng bổ sung dữ liệu, không cần train lại mô hình nền).

### 2.3. Phương án áp dụng vào Smart AI Cafe
- **Kho tri thức**: menu, giá, giờ mở cửa, chính sách đổi trả, khuyến mãi, thông tin chi nhánh — lưu dạng tài liệu ngắn, có thể cập nhật qua trang quản trị (admin panel) mà không cần lập trình lại.
- **Công nghệ gợi ý**: có thể dùng LLM có sẵn qua API (nhẹ, không cần hạ tầng GPU riêng) kết hợp cơ chế RAG, hoặc framework mã nguồn mở như Rasa/Dialogflow nếu muốn kiểm soát hoàn toàn on-premise.
- **Giao diện**: chatbox hiển thị rõ trạng thái "AI đang trả lời" vs "đã chuyển nhân viên", để khách hàng luôn biết đang nói chuyện với ai.

---

## 3. HỆ THỐNG GỢI Ý MÓN (RECOMMENDATION SYSTEM) — 80% CÁ NHÂN HÓA + 20% HOT TREND

### 3.1. Cơ sở lý thuyết

Có 2 trường phái kinh điển trong Recommender System:

**a) Content-Based Filtering**
- Gợi ý dựa trên **đặc điểm của chính sản phẩm** (nguyên liệu, loại đồ uống, độ ngọt, giá, calo...) so với sở thích đã thể hiện của người dùng.
- Cách hoạt động: biểu diễn mỗi món dưới dạng vector đặc trưng (feature vector), biểu diễn sở thích người dùng là trung bình có trọng số các món họ từng thích, rồi tính độ tương đồng (cosine similarity) giữa vector người dùng và vector từng món chưa dùng.
- Ưu điểm: hoạt động tốt ngay cả khi món mới chưa có ai mua (giải quyết một phần "cold-start" cho sản phẩm mới).
- Nhược điểm: dễ bị "bó hẹp" trong nhóm món tương tự, thiếu bất ngờ.

**b) Collaborative Filtering (CF)**
- Gợi ý dựa trên **hành vi của cộng đồng người dùng**, không cần biết đặc điểm nội dung món.
- Hai dạng chính:
  - *User-based CF*: tìm những khách hàng có hành vi mua tương tự bạn → gợi ý món họ mua mà bạn chưa thử.
  - *Item-based CF*: tìm những món hay được mua cùng nhau / bởi cùng nhóm khách → "khách mua món A cũng thường mua món B".
  - *Matrix Factorization (SVD, ALS)*: phân rã ma trận Người dùng × Món thành các vector đặc trưng ẩn (latent factors), giúp dự đoán mức độ ưa thích của một khách với món họ chưa từng mua — đây là kỹ thuật CF hiệu quả nhất khi dữ liệu lớn.
- Nhược điểm: gặp vấn đề **cold-start** với khách hàng mới (chưa có lịch sử) hoặc món mới (chưa ai mua).

**c) Hybrid Recommendation**
- Kết hợp Content-based + Collaborative Filtering, cộng thêm **Popularity-based (xu hướng/hot trend)** để bù đắp cold-start và tăng tính mới mẻ.
- Đúng với yêu cầu 80/20 của bạn, công thức điểm gợi ý cuối cùng cho mỗi món có thể thiết kế như sau:

```
Score(món) = 0.8 × Score_cá_nhân_hóa(món) + 0.2 × Score_hot_trend(món)
```

Trong đó:
- **Score_cá_nhân_hóa**: kết hợp Collaborative Filtering (hành vi khách tương tự) và Content-based (đặc điểm món khách từng thích) — ví dụ trung bình có trọng số giữa hai điểm số này.
- **Score_hot_trend**: tính theo mức độ phổ biến toàn quán trong khoảng thời gian gần (VD: số lượt bán trong 7-30 ngày gần nhất, có thể áp dụng **time-decay** để món hot "ngày càng cũ" giảm dần trọng số).

**Xử lý cold-start (khách hàng mới, chưa có lịch sử):**
- Khi chưa đủ dữ liệu hành vi cá nhân → tạm thời tăng trọng số phần hot-trend/content-based lên (VD: 100% hot trend cho khách mới hoàn toàn), sau đó giảm dần tỉ trọng này khi khách có thêm lịch sử mua hàng (>= 3-5 đơn).

### 3.2. Cách mô hình hoạt động (pipeline đề xuất)

```
Dữ liệu đầu vào
 ├─ Lịch sử đơn hàng (user_id, item_id, thời gian, số lượng)
 ├─ Đặc điểm món (loại, nguyên liệu, giá, độ ngọt/đá...)
 └─ Thống kê bán hàng toàn quán theo thời gian
        │
        ▼
 ┌─────────────────────────┐   ┌──────────────────────────┐
 │ Collaborative Filtering │   │ Content-Based Filtering  │
 │ (Matrix Factorization)  │   │ (Cosine Similarity)      │
 └─────────────┬────────────┘   └────────────┬─────────────┘
               └─────────────┬───────────────┘
                             ▼
                 Score cá nhân hóa (80%)
                             │
        Score hot-trend (20%) ──┤
                             ▼
                Sắp xếp & lọc trùng, đa dạng hóa danh sách
                             │
                             ▼
                Top-N món gợi ý hiển thị cho khách
```

### 3.3. Phương án áp dụng vào Smart AI Cafe
- **Thu thập dữ liệu**: mỗi lần khách đặt món qua app/web, lưu lại (user_id, món, thời gian, chi nhánh) làm dữ liệu huấn luyện.
- **Tần suất cập nhật mô hình**: huấn luyện lại mô hình CF theo lô (batch) mỗi ngày/tuần; điểm hot-trend có thể tính realtime hoặc theo giờ.
- **Vị trí hiển thị**: trang chủ hiển thị "Gợi ý cho bạn" (theo model hybrid) và có thể tách riêng mục "Đang hot tại quán" (chỉ dùng phần 20% kia) để minh bạch với khách.
- **Công nghệ gợi ý triển khai**: có thể dùng thư viện Python như `Surprise`, `LightFM` (hỗ trợ hybrid) hoặc tự cài đặt Matrix Factorization đơn giản nếu dữ liệu chưa lớn.

---

## 4. CHỨC NĂNG QUÉT HÓA ĐƠN → XUẤT DỮ LIỆU EXCEL

### 4.1. Cơ sở lý thuyết

Đây là bài toán **Document AI / Intelligent Document Processing**, kết hợp giữa Computer Vision và NLP có cấu trúc, gồm các tầng lý thuyết:

**a) Tiền xử lý ảnh (Image Preprocessing)**
- Các kỹ thuật thị giác máy tính cổ điển: chỉnh độ nghiêng (deskew), khử nhiễu, tăng tương phản, nhị phân hóa ảnh (binarization) — giúp bước OCR phía sau chính xác hơn, đặc biệt với ảnh chụp bill nhàu, mờ, thiếu sáng.

**b) OCR — Optical Character Recognition**
- Là mô hình nhận diện ký tự từ ảnh, thường dùng kiến trúc CRNN (Convolutional Recurrent Neural Network) hoặc Transformer-based OCR hiện đại.
- Quy trình gồm 2 bước: **Text Detection** (xác định vùng có chữ trên ảnh, dùng mô hình như DBNet, EAST) → **Text Recognition** (nhận diện chuỗi ký tự trong từng vùng đã khoanh).
- Công cụ có sẵn phổ biến: Tesseract OCR (mã nguồn mở), PaddleOCR (hỗ trợ tốt tiếng Việt có dấu), Google Cloud Vision API, AWS Textract.

**c) Trích xuất thông tin có cấu trúc (Key-Value/Information Extraction)**
- Sau khi có văn bản thô từ OCR, cần xác định đâu là "tên món", "số lượng", "đơn giá", "thành tiền", "tổng hóa đơn"...
- Hai hướng:
  - *Rule-based parsing*: dùng regex + vị trí layout (bill thường có cấu trúc dòng: `Tên món | SL | Đơn giá | Thành tiền`) — phù hợp khi hóa đơn có mẫu tương đối cố định (hóa đơn nội bộ của quán).
  - *Model-based Layout Understanding* (nếu cần tổng quát hơn, xử lý được cả hóa đơn nhà cung cấp bên ngoài với định dạng khác nhau): dùng mô hình hiểu bố cục tài liệu (Document Layout Analysis / LayoutLM-style models) kết hợp cả vị trí (x, y) và nội dung chữ để phân loại từng vùng dữ liệu.

### 4.2. Cách mô hình hoạt động (pipeline đề xuất)

```
Ảnh chụp bill (từ camera điện thoại/máy tính)
      │
      ▼
Tiền xử lý ảnh (deskew, denoise, tăng tương phản)
      │
      ▼
OCR: Text Detection + Text Recognition (PaddleOCR / Google Vision API)
      │
      ▼
Trích xuất trường dữ liệu (Information Extraction)
   ├─ Tên món / nguyên liệu
   ├─ Số lượng
   ├─ Đơn giá
   ├─ Thành tiền từng dòng
   └─ Tổng chi phí / doanh thu hóa đơn
      │
      ▼
Kiểm tra hợp lệ (validation): tổng các dòng có khớp tổng hóa đơn không?
      │
      ├── Hợp lệ → Ghi vào file Excel (theo cấu trúc bảng: cột món, SL, giá, thành tiền, ngày, loại chi phí/doanh thu)
      │
      └── Không khớp / OCR không chắc chắn → đánh dấu dòng nghi ngờ để nhân viên kiểm tra thủ công
```

### 4.3. Phương án áp dụng vào Smart AI Cafe
- **Phân loại 2 luồng dữ liệu khi xuất Excel**:
  - Hóa đơn **doanh thu** (bill bán cho khách) → cột: món uống, số lượng, đơn giá, thành tiền, thời gian, chi nhánh.
  - Hóa đơn **chi phí/nhập nguyên liệu** (bill mua hàng từ nhà cung cấp) → cột: tên nguyên liệu, số lượng, đơn giá, thành tiền, nhà cung cấp, ngày nhập.
  - Có thể dùng một bước phân loại đơn giản (dựa vào từ khóa/hình thức hóa đơn) để tự động xác định bill thuộc loại nào trước khi trích xuất.
- **Cơ chế xác thực con người (Human-in-the-loop)**: vì OCR không bao giờ đạt 100% chính xác, nên UI cần cho phép nhân viên xem trước bảng dữ liệu đã trích xuất và chỉnh sửa trước khi lưu chính thức vào file Excel/CSDL.
- **Xuất file**: dùng thư viện như `openpyxl`/`pandas` (Python) để ghi dữ liệu đã trích xuất vào file `.xlsx` theo template có sẵn, tự động cộng dồn vào báo cáo doanh thu - chi phí theo ngày/tháng.

---

## 5. KIẾN TRÚC TỔNG THỂ CỦA NỀN TẢNG AI

```
                     ┌───────────────────────────┐
                     │     Ứng dụng Web/App       │
                     │ (khách hàng & nhân viên)   │
                     └─────────────┬─────────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        ▼                          ▼                          ▼
 ┌───────────────┐        ┌────────────────┐         ┌─────────────────┐
 │ Module Chatbot │        │ Module Gợi ý    │         │ Module OCR      │
 │ (RAG + Intent) │        │ (Hybrid CF+CB)  │         │ Hóa đơn         │
 └───────┬────────┘        └────────┬────────┘         └────────┬────────┘
         │                          │                            │
         ▼                          ▼                            ▼
 ┌────────────────┐        ┌─────────────────┐          ┌─────────────────┐
 │ Kho tri thức    │        │ CSDL hành vi      │          │ CSDL hóa đơn /   │
 │ (FAQ, menu...)  │        │ người dùng        │          │ file Excel xuất  │
 └────────────────┘        └─────────────────┘          └─────────────────┘
```

Ba module hoạt động độc lập nhưng dùng chung hạ tầng dữ liệu khách hàng — điều này cho phép trong tương lai kết hợp dữ liệu (VD: dùng dữ liệu hóa đơn để làm giàu thêm dữ liệu hành vi cho hệ gợi ý).

---

NG KẾT LỰA CHỌN MÔ HÌNH

| Chức năng | Mô hình/thuật toán đề xuất | Lý do lựa chọn |
|-----------|---------------------------|----------------|
| Chatbot | RAG (Retrieval-Augmented Generation) + Intent Classification + ngưỡng confidence | Kiểm soát phạm vi trả lời tốt, dễ cập nhật kiến thức, có fallback an toàn sang người thật |
| Gợi ý món | Hybrid: Collaborative Filtering (Matrix Factorization) + Content-Based + Popularity-based (tỉ lệ 80/20) | Cá nhân hóa cao, vẫn đảm bảo món mới/hot được tiếp cận, giải quyết cold-start |
| Quét hóa đơn | OCR (PaddleOCR/Google Vision) + Rule-based/Layout-based Information Extraction + Human-in-the-loop | Độ chính xác cao với tiếng Việt, có cơ chế kiểm tra tránh sai lệch số liệu tài chính |

## 7. HƯỚNG PHÁT TRIỂN TIẾP THEO
- Thu thập phản hồi thực tế của khách trên gợi ý (thích/không thích) để tinh chỉnh trọng số 80/20 theo dữ liệu thật thay vì cố định.
- Mở rộng chatbot sang nhận diện giọng nói (Speech-to-Text) cho khách gọi món bằng giọng nói. --> Làm sau nếu có thời gian
- Dùng dữ liệu OCR hóa đơn nguyên liệu để dự báo tồn kho/nhu cầu nhập hàng (một bài toán AI READMEdự báo chuỗi thời gian - Time Series Forecasting) trong giai đoạn sau.
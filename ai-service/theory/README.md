                    SMART CAFÉ
                        │
          ┌─────────────┴─────────────┐
          ↓                           ↓
       MySQL                      Vector DB
          │                           │
          │                           │
    Dữ liệu hệ thống             Knowledge Base
          │                           │
    ├── products                 ├── content
    ├── orders                   ├── embedding
    ├── employees                └── metadata
    ├── inventory
    └── sales

01. Tạo 20–30 món menu
          ↓
02. Tạo 30–50 FAQ
          ↓
03. Tạo 10–20 policy
          ↓
04. Tạo cafe_info
          ↓
05. Đưa tất cả thành Markdown/JSON
          ↓
06. Embedding
          ↓
07. Vector DB
          ↓
08. RAG
          ↓
09. FastAPI (LLM)
          ↓
10. React Chatbox
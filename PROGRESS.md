# L&D Playbook — Tiến độ & Những điểm đã chốt

_Cập nhật: 2026-09-25 · Nhánh phát triển: `handbook/supabase-web` → merge vào `main`_

Tài liệu này ghi lại các quyết định đã chốt và trạng thái triển khai của L&D Playbook
(ứng dụng nội bộ: sơ đồ quy trình dạng swimlane + tài liệu "alignment", có luồng
draft → duyệt → publish, phân quyền theo từng mục, và so sánh biến thể theo business unit).

---

## 1. Đã hoàn thành & đang chạy trên `main`

### Sơ đồ quy trình (flowchart)
- **Đầu mũi tên hiển thị trên MỌI process** ở mọi mức zoom — giữ kích thước cố định
  ~11px trên màn hình (trước đây process lớn bị thu nhỏ nên mũi tên gần như biến mất). _(PR #56)_
- **Định tuyến mũi tên gọn gàng**: ưu tiên đường đi cục bộ, chỉ vòng ra kênh bên phải
  khi thật sự có box chắn (có kiểm tra vật cản). _(PR #54)_
  - Nhảy tới bước sâu hơn ở cột khác → rớt thẳng xuống cột trống của bước đích
    (quyết định rẽ ngang thì thoát ở đỉnh cạnh rồi rớt xuống).
  - Vòng lui ngắn (bước làm lại quay về quyết định) → đi lên **gutter bên phải**
    (dễ nhìn), tự lật sang trái nếu bên phải bị chắn.
  - Mũi tên lui xa không còn chồng lên nhau.
- **Ô zoom + câu hướng dẫn** ("Click a step to see full details, drag to move") nằm trên
  **thanh phía trên khung flowchart**, canh phải theo cột flowchart — không che chữ lane
  header (PIC), không nằm trên ô step description. Áp dụng cho mọi nơi có flowchart
  (trang xem, Compare, màn hình Preview khi sửa). _(PR #55, #56)_
- Các tinh chỉnh trước đó vẫn giữ: freeze cột phase + hàng PIC header, kéo-thả để di
  chuyển (pan), đánh số bước theo phase (1.1, 2.1…), mũi tên màu #242F52 opacity 80%,
  phase name sentence-case + đánh số.

### Pillar "Career Pathway Implementation"
- Phân cấp: **tab quốc gia** (Vietnam / Cambodia) → **mục business unit** dạng tiêu đề
  gạch chân, KHÔNG lồng shape trong shape; folder rỗng vẫn hiển thị. _(PR #50)_
- Business unit gồm: **General** (lưu quy trình/alignment chuẩn), Pizza 4P's Restaurants,
  Delivery Hub, Ippudo. _(PR #54)_
- Hover pillar này → nền navy **#242F52**, chữ trắng. _(PR #54)_
- Country/BU lưu trong nội dung tài liệu (JSON) → **không cần đổi cấu trúc DB**.

### Tạo mới & di chuyển tài liệu
- **Nút "+ New" → 3 cách tạo**: từ đầu / từ template (Approval loop, Monthly cycle,
  Team alignment) / nhân bản tài liệu có sẵn. _(PR #51)_
- **Admin di chuyển tài liệu giữa pillar** (nút ⇄ Move); chuyển vào Career Pathway sẽ
  hỏi thêm country + BU; "Move as a Draft" sẽ gỡ publish. Quyền tự đi theo pillar mới. _(PR #51)_

### Phân quyền (Manage access) — thiết kế mới
- Ô tìm người; nút gạt **None / View / Edit**; mở rộng để **ghi đè quyền theo từng tài liệu**. _(PR #52)_
- **Career Pathway có quyền theo từng business unit** (mỗi country × BU). _(PR #52)_
- Lưu bằng khóa tổng hợp trong dữ liệu thành viên → **không cần đổi DB**.

### Duyệt tài liệu (Reviewer)
- Ô "Request changes" hỗ trợ **định dạng chữ** (bold/italic/list/link như ô Full description). _(PR #53)_
- Comment của người duyệt hiện thành **banner ngay trên tài liệu**; tự xóa khi tác giả gửi
  lại / được duyệt / publish. Người xem không thấy. **Không cần cột DB mới**. _(PR #53)_

### Khác
- Màu bôi đen (select) text: **#e6dfcf**. _(PR #54)_
- Deep-link email trỏ đúng tài liệu; gửi email duyệt; thông báo Google Chat khi chờ duyệt / publish.
- Sửa lỗi crash sơ đồ khi thêm step có PIC chưa dùng; xác nhận **không giới hạn số bước**.
- Chỉ số công (working days): No. PIC = peak (max mỗi bước), ô bước hiện "N doer · M wd",
  header hiện wd/person · No. PIC · tổng wd; ghi chú áp dụng cho process có PIC là EDL/TPM/Intern.

- **Thông báo Publish → Google Chat + email nhóm: ĐÃ BẬT** (2026-09-25). Đã deploy
  `mailer.gs` (New version) và chạy `supabase_v9_publish_notify.sql`; `app_config` có
  đủ 3 key `mailer_url`, `mailer_secret`, `publish_group_email`. Đã test thành công
  (nhận được cả email lẫn thông báo Google Chat). File cấu hình lưu tại `deploy/`.
- **Nội dung thông báo chuyển sang TIẾNG ANH** (2026-09-25): cả email (duyệt & publish)
  lẫn card Google Chat. Cần deploy lại `mailer.gs` bản mới (New version) để có hiệu lực;
  nhớ điền lại `SHARED_SECRET` + `CHAT_WEBHOOK` (repo để placeholder cho bảo mật).

_Các PR đã squash-merge trong đợt này: #50 → #60._

---

## 2. Việc cần anh/chị làm (cấu hình phía Google/Supabase — không phải code)

- **Lỗi "email rate limit exceeded"** (email magic-link đăng nhập): làm theo hướng dẫn
  trong `deploy/custom-smtp-setup.md` (cấu hình Custom SMTP cho Supabase Auth) — khi nào tiện thì làm.

---

## 3. Đang tạm dừng theo yêu cầu

- **PDF export**: giữ "khoan làm".
- **Step number in list & detail**: không đụng tới (theo yêu cầu).

---

## 4. Ghi chú kỹ thuật
- Nguồn triển khai hiện tại: chỉnh trực tiếp trong `web/index.html` (một file, đã gộp CSS + JS).
- Mọi thay đổi đều được kiểm thử headless (Playwright) trước khi merge; quy ước: mỗi đợt
  góp ý → làm → test → PR → squash-merge vào `main` → reset nhánh.

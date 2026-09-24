# Bật thông báo Publish (Google Chat + email nhóm)

> ⚠️ Hai bước này phải làm trong **tài khoản Google (Apps Script)** và **Supabase dashboard**
> của 4P's — Claude không có quyền truy cập nên không tự chạy được. Làm theo hướng dẫn dưới đây.

Có 2 việc: **(A)** deploy lại `mailer.gs`, **(B)** chạy `supabase_v9_publish_notify.sql`.

---

## A. Deploy lại `mailer.gs`

1. Mở **https://script.google.com** → project mailer của L&D Playbook (project đang gửi email duyệt).
2. Chép **toàn bộ** nội dung `deploy/mailer.gs` đè lên code cũ.
3. Sửa 2 dòng đầu:
   - `SHARED_SECRET` = **đúng bằng** giá trị `mailer_secret` trong Supabase `app_config`
     (đây là lỗi hay gặp: dán code mới làm mất secret → email không gửi).
   - `CHAT_WEBHOOK` = URL webhook của Space Google Chat
     (mở Space ▸ **Apps & integrations** ▸ **Webhooks** ▸ tạo/ý copy URL).
   - (Tuỳ chọn) `CC_APPROVAL`, `SENDER_NAME`, `ALLOWED_DOMAINS`.
4. **Deploy ▸ Manage deployments** ▸ bấm ✏️ ở Web app hiện có ▸ **Version: New version** ▸ **Deploy**.
   - **Execute as:** Me  ·  **Who has access:** Anyone
   - ⚠️ Bắt buộc chọn **New version**, nếu không code mới sẽ không có hiệu lực.
5. Kiểm tra nhanh: mở URL `/exec` trên trình duyệt → thấy `{"ok":true,"service":"ld-playbook-mailer"}` là đúng.
   URL `/exec` này phải **trùng** với `mailer_url` trong Supabase `app_config`.

## B. Chạy `supabase_v9_publish_notify.sql`

1. Mở **Supabase** ▸ dự án L&D Playbook ▸ **SQL Editor** ▸ **New query**.
2. Dán nội dung `deploy/supabase_v9_publish_notify.sql` ▸ **Run**.
   - Migration này chỉ **thêm** `publish_group_email` (mặc định `lnd.edl@pizza4ps.com`);
     không đụng `mailer_url` / `mailer_secret` nên không ảnh hưởng email duyệt đang chạy.
   - Đổi email trong file nếu nhóm nhận thông báo khác.
3. (Kiểm tra) chạy:
   ```sql
   select key, value from public.app_config
   where key in ('mailer_url','mailer_secret','publish_group_email');
   ```
   Phải thấy đủ **3 dòng**. Nếu thiếu `mailer_url`/`mailer_secret`, dùng đoạn SQL đã ghi chú
   trong file để thêm (giá trị phải khớp `/exec` URL và `SHARED_SECRET` trong `mailer.gs`).

---

## Kiểm tra end-to-end
- **Duyệt:** gửi 1 tài liệu cho reviewer → reviewer nhận email + có card trong Google Chat.
- **Publish:** publish 1 tài liệu → có card trong Google Chat **và** email gửi tới nhóm `publish_group_email`.

## Sự cố thường gặp
- **Không có email khi publish:** kiểm tra `publish_group_email` đã có trong `app_config` (bước B) và mailer đã **New version** (bước A4).
- **Không có card Chat:** `CHAT_WEBHOOK` trong `mailer.gs` sai/để trống, hoặc chưa New version.
- **Không có email nào cả:** `SHARED_SECRET` (mailer.gs) ≠ `mailer_secret` (app_config) → mailer từ chối request.
- **Lỗi "email rate limit exceeded" khi đăng nhập:** đó là email *magic-link* của Supabase, khác mailer này — xử lý theo `custom-smtp-setup.md`.

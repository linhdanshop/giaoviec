# Nhac Viec Shop - Desktop Reminder

App Windows nho chay tray de nhan nhac viec tu Firebase `taskReminder`.

## Cai dat lan dau

```powershell
cd C:\Users\Admin\Documents\GitHub\giaoviec\desktop-reminder
npm install
npm start
```

## Cai chay cung Windows

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-startup.ps1
```

Muốn gỡ chạy cùng Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\remove-startup.ps1
```

## Flow

- App ghi online vào `taskReminder/desktopClients/{deviceId}`.
- Khi có `activeReminder` trong task hôm nay, app bật popup luôn nổi trên cùng, reo chuông 10 giây, tự đóng sau 1 phút.
- App ghi lịch sử đã hiện nhắc vào `taskReminder/reminderDeliveries/{date}/{reminderId}/{deviceId}`.
- Khi một máy bấm `Đã nhận nhắc`, app ghi ack vào task. Web và app máy khác tự tắt popup theo Firebase.
- Khi app đang online, web không bật popup nhắc để tránh trùng thông báo.

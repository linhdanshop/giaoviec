# Nhac Viec Shop Reminder

App Windows chay tray de nhan thong bao nhac viec tu Firebase `taskReminder`.

## Cach tien nhat: tao file cai `.exe`

Chay tren may chinh:

```powershell
cd C:\Users\Admin\Documents\GitHub\giaoviec\desktop-reminder
powershell -ExecutionPolicy Bypass -File .\scripts\build-installer.ps1
```

Sau khi build xong, vao thu muc:

```text
C:\Users\Admin\Documents\GitHub\giaoviec\desktop-reminder\dist
```

Copy file `.exe` trong thu muc `dist` sang may khac va bam cai.

## Cai tren may khac

May khac chi can chay file `.exe` da build. Khong can copy source code, khong can chay `npm install`.

Khi app chay lan dau:

- App tu tao ma thiet bi rieng cho may do.
- App tu cai chay cung Windows.
- App hien o tray.
- Co the bam chuot phai icon tray de doi ten may hoac thoat app.

## Go cai dat

Go trong Windows:

```text
Settings > Apps > Installed apps > Nhac Viec Shop Reminder > Uninstall
```

Neu dang dung ban source/debug thi go auto-start bang:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\remove-startup.ps1
```

## Chay debug tu source

Dung khi can test code:

```powershell
cd C:\Users\Admin\Documents\GitHub\giaoviec\desktop-reminder
npm install
npm start
```

## Flow

- App ghi online vao `taskReminder/desktopClients/{deviceId}`.
- `deviceId` la ma ngau nhien co dinh theo tung may, tranh trung ten may Windows.
- Khi co `activeReminder` trong task hom nay, app bat popup luon noi tren cung, reo chuong 10 giay, tu dong sau 1 phut.
- App ghi lich su da hien nhac vao `taskReminder/reminderDeliveries/{date}/{reminderId}/{deviceId}`.
- Khi mot may bam `Da nhan nhac`, app ghi ack vao task. Web va app may khac tu tat popup theo Firebase.
- Khi co app dang online, web khong bat popup nhac de tranh trung thong bao.

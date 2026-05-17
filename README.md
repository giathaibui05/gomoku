# Gomoku Online

Game cờ Gomoku multiplayer real-time.

## Tính năng
- 🔐 Đăng ký / Đăng nhập với MongoDB
- 💾 Tự động khôi phục phòng sau khi reload trang
- 🎨 Giao diện sáng (light theme)
- 💬 Chat real-time (phòng + thế giới)
- ⚡ Multiplayer qua Socket.io

## Cài đặt

```bash
npm install
```

## Cấu hình

Tạo file `.env` hoặc set biến môi trường:

```
MONGO_URI=mongodb://localhost:27017/gomoku
SESSION_SECRET=your-secret-key
PORT=3000
```

## Chạy

```bash
npm start
```

Truy cập: http://localhost:3000

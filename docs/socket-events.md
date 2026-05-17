# Socket Events — Gomoku Online

## Tổng quan

| Scope | Client emit | Server emit |
|-------|-------------|-------------|
| Global | `client_send_new_connect`, `client_required_online_count`, `client_required_list_rooms`, `client_create_room`, `client_send_message` | `server_send_online_count`, `server_send_list_rooms`, `server_send_message`, `server_message_disconnect` |
| Room | `client_join_room`, `client_leave_room`, `client_required_join_room`, `client_close_room` | `server_message_join_room`, `server_message_leave_room`, `server_send_leave_room` |
| Game | `client_required_history_game`, `client_clicked`, `client_send_win`, `client_send_want_reset`, `client_apcept_reset`, `client_send_want_undo`, `client_apcept_undo` | `server_send_history`, `server_send_clicked`, `server_send_turn`, `server_send_win`, `server_send_want_reset`, `server_send_reset`, `server_send_deny_reset`, `server_send_want_undo`, `server_send_undo`, `server_send_deny_undo` |

---

## HOME / Auth

### `client_send_new_connect`
- **Payload**: `(name: string, ack)`
- **Ack**: `(isSuccess: boolean, errorText?: string)`
- **Side effect**: server emit `server_send_online_count` tới tất cả

### `client_required_online_count`
- **Payload**: `(ack)`
- **Ack**: `(count: number)`

### `server_send_online_count`
- **Payload**: `count: number`

### `server_message_disconnect`
- **Payload**: `name: string` — tên người vừa thoát

---

## LOBBY

### `client_required_list_rooms`
- **Payload**: `(ack)`
- **Ack**: `(rooms: RoomData[])`

### `server_send_list_rooms`
- **Payload**: `RoomData[]` — broadcast mỗi khi phòng thay đổi
- **RoomData**: `{ owner, name, pass, preview, apceptViewer, users_inroom, maxPlayers }`

### `client_create_room`
- **Payload**: `({ name, pass, preview, apceptViewer }, ack)`
- **Ack**: `(isSuccess: boolean, errorText?: string)`
- **Side effect**: broadcast `server_send_list_rooms`

### `client_join_room`
- **Payload**: `(roomName: string, ack)`
- **Ack**: `(isSuccess: boolean, errorText?: string)`
- **Side effect**: emit `server_message_join_room` tới room; broadcast `server_send_list_rooms`

### `client_leave_room`
- **Payload**: `(ack)`
- **Ack**: `(isSuccess: boolean, errorText?: string)`
- **Side effect**: emit `server_message_leave_room`; xóa room nếu rỗng; broadcast `server_send_list_rooms`

### `client_required_join_room`
- **Payload**: `(roomName: string, pass: string, ack)`
- **Ack**: `(isSuccess: boolean)` — kiểm tra mật khẩu

### `client_close_room`
- **Payload**: `(roomName: string, ack)`
- **Ack**: `(isSuccess: boolean, errorText?: string)`
- **Side effect**: emit `server_send_leave_room` tới tất cả trong room

### `server_message_join_room`
- **Payload**: `{ id, player_name, room_name }`

### `server_message_leave_room`
- **Payload**: `{ id, player_name, room_name }`

### `server_send_leave_room`
- **Payload**: `reasonText: string` — gửi tới client bị kick/đóng phòng

---

## GAME

### `client_required_history_game`
- **Payload**: `(ack)`
- **Ack**: `(history: Move[] | false)`
- **Move**: `{ col, row, data: 'X'|'O' }`

### `client_clicked`
- **Payload**: `{ col, row, data: 'X'|'O' }`
- **Side effect**: server lưu history; emit `server_send_clicked` + `server_send_turn` tới room

### `server_send_clicked`
- **Payload**: `{ col, row, data }`

### `server_send_turn`
- **Payload**: `'on' | 'off'`

### `client_send_win`
- **Payload**: `name: string`
- **Side effect**: server emit `server_send_win` tới room; clear history

### `server_send_win`
- **Payload**: `{ id: socket.id, name: string }`

### Reset flow
| Event | Direction | Payload |
|-------|-----------|---------|
| `client_send_want_reset` | C→S | `name: string` |
| `server_send_want_reset` | S→C | `name: string` |
| `client_apcept_reset` | C→S | `{ apcepted: bool, from: string }` |
| `server_send_reset` | S→room | — |
| `server_send_deny_reset` | S→C | `name: string` |

### Undo flow
| Event | Direction | Payload |
|-------|-----------|---------|
| `client_send_want_undo` | C→S | `{ from, isTurn, id }` |
| `server_send_want_undo` | S→C | `{ from, isTurn, id }` |
| `client_apcept_undo` | C→S | `{ apcepted: bool, soBuoc: number, from: string, id: string }` |
| `server_send_undo` | S→room | `{ soBuoc, from, id }` |
| `server_send_deny_undo` | S→C | `name: string` |

---

## Checklist test 2 tab (T7–T12)

| # | Bước | Tab 1 | Tab 2 | Kết quả |
|---|------|-------|-------|---------|
| 1 | Đăng nhập | "Player1" | "Player2" | Online count = 2 ✓ |
| 2 | Tab1 tạo phòng | Tạo "Room1" → Vào ngay | — | Tab1 vào game; Tab2 thấy phòng trong bảng ✓ |
| 3 | Tab2 vào phòng | — | Vào "Room1" | Cả 2 thấy thông báo join ✓ |
| 4 | Tab1 đánh X | Click ô bất kỳ | — | Tab2 thấy X, lượt chuyển sang Tab2 ✓ |
| 5 | Tab2 đánh O | — | Click ô khác | Tab1 thấy O, lượt về Tab1 ✓ |
| 6 | Tab1 xin undo | Click Undo | — | Tab2 thấy popup xác nhận ✓ |
| 7 | Tab2 đồng ý undo | — | Đồng ý | Quân cờ bị thu về, toast thành công ✓ |
| 8 | Tab1 xin ván mới | Click New | — | Tab2 thấy popup xác nhận ✓ |
| 9 | Tab2 đồng ý | — | Đồng ý | Bàn cờ reset ✓ |
| 10 | Chat world | Gửi tin | — | Tab2 thấy tin nhắn ✓ |
| 11 | Chat room | Gửi tin (tab room) | — | Chỉ người trong phòng thấy ✓ |
| 12 | Tab1 thắng (5 quân) | Đánh đủ 5 | — | Popup thắng/thua xuất hiện ✓ |
| 13 | Tab2 rời phòng | — | Rời | Tab1 thấy thông báo leave ✓ |
| 14 | Chủ phòng xóa phòng | Tab1 xóa | — | Tab2 bị đẩy ra sảnh ✓ |

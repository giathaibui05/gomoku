var port = process.env.PORT || 3000;
var express = require("express");
var session = require("express-session");
var MongoStore = require("connect-mongo");
var mongoose = require("mongoose");
var bcrypt = require("bcryptjs");
var app = express();

// Ensure correct MIME types for font files
express.static.mime.define({
    'font/woff2': ['woff2'],
    'font/woff': ['woff'],
    'application/font-woff2': ['woff2']
});

var MONGO_URI = process.env.MONGO_URI || "mongodb+srv://20235424:blqwVwNHd7ythQF4@cluster0.rp7ztuc.mongodb.net/gomoku?retryWrites=true&w=majority";
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log("✅ MongoDB connected"))
    .catch(err => console.error("❌ MongoDB connection error:", err.message));

var UserSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true, trim: true },
    password: { type: String, required: true }
}, { timestamps: true });
var UserModel = mongoose.model("User", UserSchema);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.set('trust proxy', 1);
app.use(session({
    secret: process.env.SESSION_SECRET || "gomoku-secret-key-2024",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: MONGO_URI }),
    cookie: { 
    maxAge: 7 * 24 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production', // ← thêm
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax' // ← thêm
}
}));

app.post("/api/register", async (req, res) => {
    try {
        let { username, password } = req.body;
        if (!username || !password) return res.json({ ok: false, msg: "Thiếu thông tin" });
        username = username.trim();
        if (username.length < 3) return res.json({ ok: false, msg: "Tên tối thiểu 3 ký tự" });
        if (username.length > 20) return res.json({ ok: false, msg: "Tên tối đa 20 ký tự" });
        if (password.length < 4) return res.json({ ok: false, msg: "Mật khẩu tối thiểu 4 ký tự" });
        let exist = await UserModel.findOne({ username: { $regex: new RegExp("^" + username + "$", "i") } });
        if (exist) return res.json({ ok: false, msg: "Tên đã được sử dụng" });
        let hashed = await bcrypt.hash(password, 10);
        await UserModel.create({ username, password: hashed });
        req.session.username = username;
        res.json({ ok: true, username });
    } catch (e) {
        res.json({ ok: false, msg: e.code === 11000 ? "Tên đã được sử dụng" : "Lỗi server" });
    }
});

app.post("/api/login", async (req, res) => {
    try {
        let { username, password } = req.body;
        if (!username || !password) return res.json({ ok: false, msg: "Thiếu thông tin" });
        username = username.trim();
        let user = await UserModel.findOne({ username: { $regex: new RegExp("^" + username + "$", "i") } });
        if (!user) return res.json({ ok: false, msg: "Tên đăng nhập không tồn tại" });
        let match = await bcrypt.compare(password, user.password);
        if (!match) return res.json({ ok: false, msg: "Mật khẩu không đúng" });
        req.session.username = user.username;
        res.json({ ok: true, username: user.username });
    } catch (e) {
        res.json({ ok: false, msg: "Lỗi server" });
    }
});

app.post("/api/logout", (req, res) => { req.session.destroy(); res.json({ ok: true }); });
app.get("/api/me", (req, res) => {
    if (req.session.username) res.json({ ok: true, username: req.session.username });
    else res.json({ ok: false });
});

var server = require("http").Server(app);
var io = require("socket.io")(server);
server.listen(port, () => console.log(`🎮 Gomoku server running on http://localhost:${port}`));

// ========================== Classes =====================
class User {
    constructor(_id, _name) { this.id = _id; this.name = _name; this.isViewer = false; this.roomName = null; }
    setRoomName(_n) { this.roomName = _n; }
    getRoomName() { return this.roomName; }
}

class ListUsers {
    constructor() { this.users = []; }
    getUsersCount() { return this.users.length; }
    addUser(u) { this.users.push(u); }
    removeUser(u) { var i = this.users.indexOf(u); if (i >= 0) { this.users.splice(i, 1); return true; } return false; }
    findUserName(n) { return this.users.find(u => u.name === n) || null; }
    findUserID(id) { return this.users.find(u => u.id === id) || null; }
}

// ======================== Timer constants ========================
var TIMER_TOTAL_MS = 10 * 60 * 1000; // 10 phút mỗi người
var TIMER_LOW_MS   = 30 * 1000;      // dưới 30s = low
var TIMER_BONUS_MS = 1000;           // +1s bonus mỗi nước khi low

class Room {
    constructor(_owner, _name, _pass, _preview, _apceptViewer, _maxPlayers) {
        this.owner = _owner; this.name = _name; this.pass = _pass;
        this.preview = _preview; this.apceptViewer = _apceptViewer;
        this.maxPlayers = _maxPlayers || 2; this.maxUsers = 10;
        this.users = []; this.chat = []; this.history = [];
        this.gameStarted = false;
        this.timerMs = [TIMER_TOTAL_MS, TIMER_TOTAL_MS];
        this.currentTimerPlayer = 0;
        this.timerLastTick = null;
        this._timerInterval = null;
        this._lastSync = null;
    }
    getUsersCount() { return this.users.length; }
    getPlayers() { return this.users.filter(u => !u.isViewer); }
addUser(u) {
  if (!u || typeof u.setRoomName !== 'function') {
    console.log('[addUser] FAIL: invalid user', u && u.name);
    return false;
  }

  // Prevent duplicate
  if (this.users.some(x => x.id === u.id || x.name === u.name)) {
    console.log('[addUser] already in room:', u.name, 'room:', this.name);
    return true;
  }

  console.log('[addUser] room:', this.name, 'users:', this.users.length, '/', this.maxPlayers, 'adding:', u.name);

  if (this.users.length < this.maxPlayers) {
    u.setRoomName(this.name);
    this.users.push(u);
    console.log('[addUser] SUCCESS as player');
    return true;
  } else if (this.apceptViewer && this.users.length < this.maxUsers) {
    u.setRoomName(this.name);
    u.isViewer = true;
    this.users.push(u);
    console.log('[addUser] SUCCESS as viewer');
    return true;
  }

  console.log('[addUser] FAIL: room full. users:', this.users.map(x=>x.name), 'maxPlayers:', this.maxPlayers);
  return false;
}

removeUser(u) {
    const i = this.users.indexOf(u);
    if (i >= 0) {
        if (typeof this.users[i].setRoomName === 'function') {
            this.users[i].setRoomName(null);
        }
        this.users.splice(i, 1);
        return true;
    }
    return false;
}
removeAllUsers() {
    this.users.forEach(user => {
        if (typeof user.setRoomName === 'function') {
            user.setRoomName(null);
        }
    });
    this.users = [];
}
    addHistory(h) { this.history.push(h); }
    getHistory() { return this.history; }
    undo() { this.history.pop(); }
    clearHistory() {
        this.history = [];
        this.gameStarted = false;
        this.stopTimer();
        this.timerMs = [TIMER_TOTAL_MS, TIMER_TOTAL_MS];
        this.currentTimerPlayer = 0;
    }

    // ---- Server-side timer ----
    initTimer() {
        this.timerMs = [TIMER_TOTAL_MS, TIMER_TOTAL_MS];
        this.currentTimerPlayer = 0; // index 0 = player0 đi trước
        this.timerLastTick = null;
        this._timerInterval = null;
    }
    startTimer(io) {
        if (this._timerInterval) clearInterval(this._timerInterval);
        this.timerLastTick = Date.now();
        this._timerInterval = setInterval(() => {
            if (!this.gameStarted) { this.stopTimer(); return; }
            var now = Date.now();
            var elapsed = now - this.timerLastTick;
            this.timerLastTick = now;
            var cur = this.currentTimerPlayer;
            this.timerMs[cur] -= elapsed;
            if (this.timerMs[cur] <= 0) {
                this.timerMs[cur] = 0;
                this.stopTimer();
                // Ai hết giờ?
                var players = this.getPlayers();
                if (players.length < 2) return;
                var loser = players[cur];
                var winner = players[1 - cur];
                this.clearHistory();
                io.sockets.to(this.name).emit('server_timeout_lose', {
                    loserName: loser.name,
                    winnerName: winner.name
                });
                return;
            }
            // Broadcast sync mỗi 2s
            if (!this._lastSync || now - this._lastSync >= 2000) {
                this._lastSync = now;
                io.sockets.to(this.name).emit('server_timer_sync', {
                    timers: this.timerMs,
                    current: this.currentTimerPlayer
                });
            }
        }, 200);
    }
    stopTimer() {
        if (this._timerInterval) { clearInterval(this._timerInterval); this._timerInterval = null; }
    }
    switchTimerTo(playerIndex) {
        var prev = this.currentTimerPlayer;
        // Bonus +1s nếu người vừa đánh còn dưới 30s
        if (this.timerMs[prev] < TIMER_LOW_MS) {
            this.timerMs[prev] = Math.min(this.timerMs[prev] + TIMER_BONUS_MS, TIMER_LOW_MS);
        }
        this.currentTimerPlayer = playerIndex;
        this.timerLastTick = Date.now();
    }
    getTimerState() {
        return { timers: this.timerMs.slice(), current: this.currentTimerPlayer };
    }
}

class ListRooms {
    constructor() { this.rooms = []; }
    getRoomsCount() { return this.rooms.length; }
    addRoom(r) { this.rooms.push(r); }
    removeRoom(r) { var i = this.rooms.indexOf(r); if (i >= 0) { this.rooms.splice(i, 1); return true; } return false; }
    findRoom(n) { return this.rooms.find(r => r.name === n) || null; }
}

// ========================== Globals =====================
var list_rooms = new ListRooms();
var list_users = new ListUsers();
// Grace period: username -> { user, roomName, timer }
var pendingReconnect = {};
const GRACE_MS = 15000;

function getRoomDataArray() {
    return list_rooms.rooms.map(r => ({
        owner: r.owner, name: r.name, pass: r.pass, preview: r.preview,
        apceptViewer: r.apceptViewer, users_inroom: r.users.length, maxPlayers: r.maxPlayers
    }));
}
function sendListRooms(s) {
    var d = getRoomDataArray();
    if (s) s.emit('server_send_list_rooms', d);
    else io.sockets.emit('server_send_list_rooms', d);
}
function sendOnlineCount(s) {
    var c = list_users.getUsersCount();
    if (s) s.emit('server_send_online_count', c);
    else io.sockets.emit('server_send_online_count', c);
}

function startGame(room) {
    var players = room.getPlayers();
    if (players.length !== 2) return;
    room.gameStarted = true;
    room.initTimer();
    var p0 = io.sockets.sockets.get(players[0].id);
    var p1 = io.sockets.sockets.get(players[1].id);
    if (p0) p0.emit('server_send_turn', 'on');
    if (p1) p1.emit('server_send_turn', 'off');
    io.sockets.to(room.name).emit('server_game_start', {
        player0: players[0].name, player1: players[1].name,
        timerState: room.getTimerState()
    });
    room.startTimer(io);
}

// ======================== Socket.io ==========================
io.on("connection", function(soc) {

    soc.on('client_send_new_connect', function(name, onSuccess) {
        if (!name || !name.trim()) { onSuccess(false, 'Vui lòng nhập tên'); return; }
        name = name.trim();
        if (name.length > 20) { onSuccess(false, 'Tên tối đa 20 ký tự'); return; }

        // Check grace period reconnect
        if (pendingReconnect[name]) {
            var pending = pendingReconnect[name];
            clearTimeout(pending.timer);
            delete pendingReconnect[name];

            var user = pending.user;
            user.id = soc.id;
            soc.caro_user = user;
            list_users.addUser(user);

            var roomName = pending.roomName;
            var room = roomName ? list_rooms.findRoom(roomName) : null;
            if (room && roomName) {
                // Update user reference in room
                var idx = room.users.findIndex(u => u.name === name);
                if (idx >= 0) room.users[idx] = user;
                else { user.setRoomName(roomName); room.users.push(user); }
                soc.join(roomName);
            }

            sendOnlineCount();
            onSuccess(true, { reconnected: true, roomName: roomName || null });
            return;
        }

        // Normal connect
        var find = list_users.findUserName(name);
        if (find) {
            // Kiểm tra socket cũ còn sống không
            var oldSoc = io.sockets.sockets.get(find.id);
            if (!oldSoc || !oldSoc.connected) {
                // Socket cũ đã chết nhưng chưa kịp xử lý disconnect
                // → Cho socket mới tiếp quản user (reconnect không qua grace period)
                list_users.removeUser(find);
                find.id = soc.id;
                soc.caro_user = find;
                list_users.addUser(find);
                var prevRoom = find.getRoomName();
                if (prevRoom) soc.join(prevRoom);
                sendOnlineCount();
                onSuccess(true, { reconnected: !!prevRoom, roomName: prevRoom || null });
            } else {
                // Socket cũ vẫn còn — nhưng có thể là tab cũ của chính người này đang reload
                // Cưỡng chế tiếp quản: ngắt kết nối socket cũ, cho socket mới tiếp quản
                // (an toàn vì đã xác thực cùng username qua HTTP session ở /api/me)
                var prevRoom = find.getRoomName();
                list_users.removeUser(find);
                find.id = soc.id;
                soc.caro_user = find;
                list_users.addUser(find);
                if (prevRoom) soc.join(prevRoom);
                // Ngắt socket cũ sau khi đã chuyển giao
                try { oldSoc.disconnect(true); } catch(e) {}
                sendOnlineCount();
                onSuccess(true, { reconnected: !!prevRoom, roomName: prevRoom || null });
            }
            return;
        }

        var user = new User(soc.id, name);
        soc.caro_user = user;
        list_users.addUser(user);
        sendOnlineCount();
        onSuccess(true, { reconnected: false });
    });

    soc.on('client_rejoin_room', function(roomName, username, onSuccess) {
        var room = list_rooms.findRoom(roomName);
        if (!room) { onSuccess(false, 'Phòng không còn tồn tại'); return; }
        var user = soc.caro_user;
        if (!user) { onSuccess(false, 'Chưa đăng ký'); return; }

        // Xóa grace-period timer nếu có
        if (pendingReconnect[username]) {
            clearTimeout(pendingReconnect[username].timer);
            delete pendingReconnect[username];
            console.log('[rejoin] Cleared pending reconnect for:', username);
        }

        // Tìm ghost user cùng tên trong room (socket cũ chưa disconnect hoặc đang trong grace period)
        var existingInRoom = room.users.find(u => u.name === username);
        if (existingInRoom) {
            // Tiếp quản slot cũ: cập nhật id socket mới, gán lại caro_user
            existingInRoom.id = soc.id;
            soc.caro_user = existingInRoom;
            existingInRoom.setRoomName(roomName);
            console.log('[rejoin] Took over existing slot for:', username);
        } else {
            // Chưa có slot → thêm mới
            if (!room.addUser(user)) { onSuccess(false, 'Phòng đã đầy'); return; }
        }
        if (!soc.rooms.has(roomName)) soc.join(roomName);

        io.sockets.to(roomName).emit('server_message_join_room', {
            id: soc.id, player_name: user.name, room_name: roomName
        });
        sendListRooms();

        var players = room.getPlayers();
        // Determine whose turn: player0 on even history length, player1 on odd
        var isP0 = players.length > 0 && players[0].name === username;
        var isEven = room.history.length % 2 === 0;
        var turnState = ((isP0 && isEven) || (!isP0 && !isEven)) ? 'on' : 'off';

        onSuccess(true, {
            history: room.getHistory(),
            turnState: turnState,
            players: players.map(p => p.name)
        });

        if (players.length === 2) {
            io.sockets.to(roomName).emit('server_player_reconnected', { name: username });
            var p0soc = io.sockets.sockets.get(players[0].id);
            var p1soc = io.sockets.sockets.get(players[1].id);
            var even = room.history.length % 2 === 0;
            if (p0soc) p0soc.emit('server_send_turn', even ? 'on' : 'off');
            if (p1soc) p1soc.emit('server_send_turn', even ? 'off' : 'on');
        }
    });

    soc.on("disconnect", function() {
        if (!soc.caro_user) return;
        var user = soc.caro_user;
        var nameRoom = user.getRoomName();

        list_users.removeUser(user);
        sendOnlineCount();

        if (nameRoom) {
            var room = list_rooms.findRoom(nameRoom);
            if (room) {
                var players = room.getPlayers();
                var isPlayer = players.some(p => p.name === user.name);

                if (isPlayer && room.gameStarted && players.length === 2) {
                    // Start grace period
                    io.sockets.to(nameRoom).emit('server_player_disconnected', {
                        name: user.name, graceMs: GRACE_MS
                    });

                    var timer = setTimeout(function() {
                        delete pendingReconnect[user.name];
                        var roomStill = list_rooms.findRoom(nameRoom);
                        if (roomStill) {
                            var remaining = roomStill.getPlayers().filter(p => p.name !== user.name);
                            // ✅ FIX: xóa history TRƯỚC khi broadcast win
                            // → bất kỳ rejoin nào sau đây sẽ nhận history rỗng → bàn cờ sạch
                            roomStill.clearHistory();
                            if (remaining.length > 0) {
                                io.sockets.to(nameRoom).emit('server_send_win', {
                                    id: remaining[0].id, name: remaining[0].name, reason: 'disconnect'
                                });
                            }
                            roomStill.removeUser(user);
                            if (roomStill.getUsersCount() === 0) list_rooms.removeRoom(roomStill);
                            sendListRooms();
                        }
                        io.sockets.to(nameRoom).emit('server_message_disconnect', user.name);
                    }, GRACE_MS);

                    pendingReconnect[user.name] = { user, roomName: nameRoom, timer };
                } else {
                    room.removeUser(user);
                    if (room.getUsersCount() === 0) list_rooms.removeRoom(room);
                    soc.leave(nameRoom);
                    io.sockets.to(nameRoom).emit('server_message_disconnect', user.name);
                    sendListRooms();
                }
            }
        } else {
            io.sockets.emit('server_message_disconnect', user.name);
        }
    });

    soc.on('client_required_online_count', function(cb) { cb(list_users.getUsersCount()); });
    soc.on('client_required_list_rooms', function(cb) { cb(getRoomDataArray()); });

    soc.on('client_create_room', function(data, cb) {
        if (!soc.caro_user) { cb(false, 'Phiên đăng nhập hết hạn, vui lòng tải lại trang'); return; }
        if (!data.name || !data.name.trim()) { cb(false, 'Tên phòng không hợp lệ'); return; }
        if (list_rooms.findRoom(data.name)) { cb(false, 'Phòng đã tồn tại'); return; }
        var room = new Room(soc.caro_user, data.name, data.pass, data.preview, data.apceptViewer);
        list_rooms.addRoom(room);
        console.log('[create_room] name:', data.name, 'owner:', soc.caro_user && soc.caro_user.name, 'apceptViewer:', data.apceptViewer);
        sendListRooms();
        cb(true);
    });

    soc.on('client_join_room', function(nameRoom, cb) {
        if (!soc.caro_user) { cb(false, 'Phiên đăng nhập hết hạn, vui lòng tải lại trang'); return; }
        var room = list_rooms.findRoom(nameRoom);
        if (!room) { cb(false, 'Phòng không tồn tại'); return; }

        // Prevent joining if already in a different room
        var currentRoomName = soc.caro_user ? soc.caro_user.getRoomName() : null;
        if (currentRoomName && currentRoomName !== nameRoom) {
            cb(false, 'Bạn đang ở phòng khác, hãy rời phòng trước');
            return;
        }

        console.log('[join_room] user:', soc.caro_user && soc.caro_user.name, 'room:', nameRoom, 'users_before:', room.users.map(u=>u.name), 'gameStarted:', room.gameStarted);
        if (!room.addUser(soc.caro_user)) { cb(false, 'Phòng đã đầy'); return; }
        soc.join(nameRoom);
        io.sockets.to(nameRoom).emit('server_message_join_room', {
            id: soc.caro_user.id, player_name: soc.caro_user.name, room_name: nameRoom
        });
        sendListRooms();
        cb(true);
        if (room.getPlayers().length === 2) startGame(room);
    });

    soc.on('client_leave_room', function(cb) {
        var roomName = soc.caro_user ? soc.caro_user.getRoomName() : null;
        if (!roomName) { cb(false, 'Bạn chưa vào phòng nào'); return; }
        var room = list_rooms.findRoom(roomName);
        if (!room) { cb(false, 'Không tìm thấy phòng'); return; }

        // Nếu đang trong ván đấu, tuyên bố đối thủ thắng trước khi rời
        var players = room.getPlayers();
        var leavingPlayer = players.find(p => p.id === soc.caro_user.id);
        if (leavingPlayer && players.length === 2 && room.gameStarted) {
            var opponent = players.find(p => p.id !== soc.caro_user.id);
            if (opponent) {
                room.clearHistory();
                io.sockets.to(roomName).emit('server_send_win', {
                    id: opponent.id, name: opponent.name, reason: 'leave'
                });
            }
        }

        room.removeUser(soc.caro_user);
        soc.leave(roomName);
        io.sockets.emit('server_message_leave_room', {
            id: soc.caro_user.id, player_name: soc.caro_user.name, room_name: roomName
        });
        if (room.getUsersCount() === 0) list_rooms.removeRoom(room);
        sendListRooms();
        cb(true);
    });

    soc.on('client_required_join_room', function(nameRoom, inpPass, cb) {
        var room = list_rooms.findRoom(nameRoom);
        if (!room) { cb(false); return; }
        cb(inpPass === room.pass);
    });

    soc.on('client_close_room', function(nameRoom, cb) {
        var room = list_rooms.findRoom(nameRoom);
        if (!room) { if (cb) cb(false, 'Không tìm thấy phòng'); return; }
        if (room.owner.id !== soc.caro_user.id) { if (cb) cb(false, 'Bạn không phải chủ phòng'); return; }
        io.sockets.to(room.name).emit('server_send_leave_room', 'Chủ phòng đã đóng phòng, bạn được đưa ra sảnh!');
        if (cb) cb(true);
    });

    soc.on('client_send_message', function(data) {
        if (!soc.caro_user) return;
        var roomName = soc.caro_user.getRoomName();
        // Client specifies channel: 'world' or 'room'
        var channel = data.channel || 'room';
        var isRoom = (channel === 'room' && !!roomName);
        var payload = { id: soc.id, from: data.from, mes: data.mes, room: isRoom };
        if (isRoom) {
            // Send to everyone in room EXCEPT sender (sender already shows locally)
            soc.broadcast.to(roomName).emit('server_send_message', payload);
        } else {
            // World chat: send to everyone except sender
            soc.broadcast.emit('server_send_message', payload);
        }
    });

    soc.on('client_required_history_game', function(cb) {
        var roomName = soc.caro_user ? soc.caro_user.getRoomName() : null;
        if (!roomName) { cb(false); return; }
        var room = list_rooms.findRoom(roomName);
        if (!room) { cb(false); return; }
        cb(room.getHistory(), room.getPlayers().map(p => p.name), room.getTimerState());
    });

    soc.on("client_clicked", function(data) {
        var roomName = soc.caro_user ? soc.caro_user.getRoomName() : null;
        if (!roomName) return;
        var room = list_rooms.findRoom(roomName);
        if (!room) return;
        room.addHistory(data);
        // Switch server-side timer sang player còn lại
        var players = room.getPlayers();
        var myIdx = players.findIndex(p => p.id === soc.id);
        if (myIdx >= 0) room.switchTimerTo(1 - myIdx);
        // Broadcast ngay timer state mới
        io.sockets.to(roomName).emit('server_timer_sync', room.getTimerState());
        soc.broadcast.to(roomName).emit('server_send_clicked', data);
        soc.broadcast.to(roomName).emit('server_send_turn', 'on');
        soc.emit('server_send_turn', 'off');
    });

    soc.on('client_send_want_reset', function(name) {
        var roomName = soc.caro_user ? soc.caro_user.getRoomName() : null;
        if (!roomName) return;
        soc.broadcast.to(roomName).emit('server_send_want_reset', name);
    });

    soc.on('client_apcept_reset', function(data) {
        var roomName = soc.caro_user ? soc.caro_user.getRoomName() : null;
        if (!roomName) return;
        var room = list_rooms.findRoom(roomName);
        if (!room) return;
        if (data.apcepted) {
            room.clearHistory();
            io.sockets.to(roomName).emit('server_send_reset');
            if (room.getPlayers().length === 2) startGame(room);
        } else {
            soc.broadcast.to(roomName).emit('server_send_deny_reset', data.from);
        }
    });

    soc.on('client_send_want_undo', function(data) {
        var roomName = soc.caro_user ? soc.caro_user.getRoomName() : null;
        if (!roomName) return;
        soc.broadcast.to(roomName).emit('server_send_want_undo', data);
    });

    soc.on('client_apcept_undo', function(data) {
        var roomName = soc.caro_user ? soc.caro_user.getRoomName() : null;
        if (!roomName) return;
        var room = list_rooms.findRoom(roomName);
        if (!room) return;
        if (data.apcepted) {
            for (var i = 0; i < data.soBuoc; i++) room.undo();
            io.sockets.to(roomName).emit('server_send_undo', data);
        } else {
            soc.broadcast.to(roomName).emit('server_send_deny_undo', data.from);
        }
    });

    soc.on('client_send_win', function(name) {
        var roomName = soc.caro_user ? soc.caro_user.getRoomName() : null;
        if (!roomName) return;
        var room = list_rooms.findRoom(roomName);
        if (room) room.clearHistory();
        io.sockets.to(roomName).emit('server_send_win', { id: soc.id, name: name });
    });

    soc.on('client_timeout_lose', function() {
        var roomName = soc.caro_user ? soc.caro_user.getRoomName() : null;
        if (!roomName) return;
        var room = list_rooms.findRoom(roomName);
        if (!room) return;
        var opponent = room.getPlayers().find(p => p.id !== soc.id);
        if (!opponent) return;
        room.clearHistory();
        io.sockets.to(roomName).emit('server_send_win', { id: opponent.id, name: opponent.name, reason: 'timeout' });
    });

    soc.on('client_surrender', function(name) {
        var roomName = soc.caro_user ? soc.caro_user.getRoomName() : null;
        if (!roomName) return;
        var room = list_rooms.findRoom(roomName);
        if (!room) return;
        var opponent = room.getPlayers().find(p => p.id !== soc.id);
        if (!opponent) return;
        room.clearHistory();
        io.sockets.to(roomName).emit('server_surrender', {
            surrenderedName: name,
            winnerName: opponent.name,
            winnerId: opponent.id
        });
    });
});

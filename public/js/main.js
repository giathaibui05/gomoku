// ============================================================
// main.js — App bootstrap with Auth + Session Persistence
// ============================================================

let player_name = "";
let socket;
let _p5Instance = null;

function switchAuthTab(tab) {
    document.getElementById('tabLogin').classList.toggle('active', tab === 'login');
    document.getElementById('tabRegister').classList.toggle('active', tab === 'register');
    document.getElementById('panelLogin').classList.toggle('active', tab === 'login');
    document.getElementById('panelRegister').classList.toggle('active', tab === 'register');
    document.getElementById('loginErr').textContent = '';
    document.getElementById('regErr').textContent = '';
}

async function apiPost(url, body) {
    const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    return r.json();
}

async function checkSession() {
    const r = await fetch('/api/me');
    return r.json();
}

function afterAuth(username) {
    player_name = username;
    document.getElementById('player_name').textContent = username;
    document.getElementById('authOverlay').style.display = 'none';
    document.querySelector('.before-game').style.display = 'flex';

    const SERVER_URL = window.location.origin;
    connect(SERVER_URL);

    socket.on("connect", function() {
        const savedRoom = sessionStorage.getItem('gomoku_room');

        socket.emit('client_send_new_connect', player_name, function(isSuccess, extra) {
            if (isSuccess) {
                setupEventSocket();
                setupMyChatBox();

                // Check if user was reconnected automatically (was in grace period)
                if (extra && extra.reconnected && extra.roomName) {
                    // User was in pending state — restore directly
                    _restoreRoom(extra.roomName);
                } else if (savedRoom) {
                    // Try to rejoin
                    socket.emit('client_rejoin_room', savedRoom, player_name, function(ok, data) {
                        if (ok) {
                            _applyRejoin(savedRoom, data);
                        } else {
                            sessionStorage.removeItem('gomoku_room');
                            addToast(data || "Phòng không còn tồn tại", "warning");
                            refreshData();
                        }
                    });
                } else {
                    refreshData();
                }
            } else {
                // Name conflict — likely old socket still alive
                setupEventSocket();
                setupMyChatBox();
                if (savedRoom) {
                    socket.emit('client_rejoin_room', savedRoom, player_name, function(ok, data) {
                        if (ok) {
                            _applyRejoin(savedRoom, data);
                        } else {
                            sessionStorage.removeItem('gomoku_room');
                            refreshData();
                        }
                    });
                } else {
                    refreshData();
                }
            }
        });
    });
}

function _restoreRoom(roomName) {
    // Server đã tái lập socket vào đúng room qua pendingReconnect,
    // nhưng vẫn cần emit client_rejoin_room để server xác nhận, trả history/turn
    // và quan trọng nhất: server xóa pending grace-period timer
    socket.emit('client_rejoin_room', roomName, player_name, function(ok, data) {
        if (ok) {
            _applyRejoin(roomName, data);
        } else {
            sessionStorage.removeItem('gomoku_room');
            addToast(data || "Phòng không còn tồn tại", "warning");
            refreshData();
        }
    });
}

function _applyRejoin(roomName, data) {
    if (!currentRoom) currentRoom = { name: roomName };
    document.getElementById('currentRoomName').textContent = roomName;
    openGame(true);
    if (_p5Instance) _p5Instance.remove();
    setTimeout(function() {
        _p5Instance = new p5(caro, "cnv");
        // After p5 setup, feed in history + turn
        setTimeout(function() {
            if (window._pendingRejoinData) {
                // handled in caro.js setup
            }
        }, 200);
    }, 50);
    window._pendingRejoinData = data; // caro.js will pick this up in setup
    addToast("Đã khôi phục phòng " + roomName, "success");
    refreshData();
}

document.addEventListener('DOMContentLoaded', function() {

    document.getElementById('loginPassword').addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('btnLogin').click();
    });
    document.getElementById('regPassword').addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('btnRegister').click();
    });

    document.getElementById('btnLogin').addEventListener('click', async function() {
        const username = document.getElementById('loginUsername').value.trim();
        const password = document.getElementById('loginPassword').value;
        const errEl = document.getElementById('loginErr');
        errEl.textContent = '';
        if (!username || !password) { errEl.textContent = 'Vui lòng nhập đầy đủ thông tin'; return; }
        this.disabled = true;
        this.textContent = 'Đang đăng nhập...';
        try {
            const res = await apiPost('/api/login', { username, password });
            if (res.ok) { afterAuth(res.username); }
            else { errEl.textContent = res.msg || 'Đăng nhập thất bại'; }
        } catch(e) { errEl.textContent = 'Lỗi kết nối server'; }
        this.disabled = false;
        this.innerHTML = '<i class="fas fa-sign-in-alt"></i> Đăng nhập';
    });

    document.getElementById('btnRegister').addEventListener('click', async function() {
        const username = document.getElementById('regUsername').value.trim();
        const password = document.getElementById('regPassword').value;
        const errEl = document.getElementById('regErr');
        errEl.textContent = '';
        if (!username || !password) { errEl.textContent = 'Vui lòng nhập đầy đủ thông tin'; return; }
        this.disabled = true;
        this.textContent = 'Đang đăng ký...';
        try {
            const res = await apiPost('/api/register', { username, password });
            if (res.ok) { afterAuth(res.username); }
            else { errEl.textContent = res.msg || 'Đăng ký thất bại'; }
        } catch(e) { errEl.textContent = 'Lỗi kết nối server'; }
        this.disabled = false;
        this.innerHTML = '<i class="fas fa-user-plus"></i> Đăng ký & Vào game';
    });

    document.getElementById('btnLogout').addEventListener('click', async function() {
        const r = await Swal.fire({
            title: 'Đăng xuất?',
            text: 'Bạn sẽ được đưa về màn hình đăng nhập.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Đăng xuất',
            cancelButtonText: 'Hủy',
            confirmButtonColor: '#e84560'
        });
        if (!r.value) return;
        sessionStorage.removeItem('gomoku_room');
        await fetch('/api/logout', { method: 'POST' });
        window.location.reload();
    });

    checkSession().then(res => {
        if (res.ok) afterAuth(res.username);
    }).catch(() => {});
});

$(document).on("input", "#inpSearch", function() {
    let keyword = $(this).val().toLowerCase().trim();
    if (!keyword) { showListRooms(Rooms); return; }
    let filtered = Rooms.filter(r =>
        (r.name && r.name.toLowerCase().includes(keyword)) ||
        (r.owner && r.owner.name && r.owner.name.toLowerCase().includes(keyword)) ||
        (r.preview && r.preview.toLowerCase().includes(keyword))
    );
    showListRooms(filtered);
});

$(document).on("click", "#btnTaoPhong", function() { taoPhong(); });
$(document).on("click", "#btnLeaveRoom", function() { xacNhanRoiPhong(); });
$(document).on("click", "#btnRandomRoom", function() { joinRandomRoom(); });

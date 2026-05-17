// ============================================================
// setup_socket.js — Socket events + Lobby logic
// ============================================================

let Rooms = [];
let currentRoom = null;

function connect(server_url) {
    socket = io.connect(server_url, {
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: Infinity,
        forceNew: true
    });

    socket.on("connect", function() {
        console.log("✅ Connected to " + server_url);
    });

    socket.on("disconnect", function(reason) {
        addToast("Mất kết nối với server", "error");
        if (reason === "io server disconnect") socket.connect();
    });

    socket.on("reconnect", function(attemptNumber) {
        // Don't auto-reload — let the connect handler re-register
        addToast("Đã kết nối lại server!", "success");
    });

    socket.on("reconnecting", function(attemptNumber) {
        addToast("Đang kết nối lại... (lần " + attemptNumber + ")", "warning");
    });
}

function setupEventSocket() {
    socket.on("server_message_disconnect", function(name) {
        addMessage_MCB('conv-world', 'Server', name + " đã thoát.", true);
    });

    socket.on("server_send_list_rooms", function(data) {
        showListRooms(data);
    });

    socket.on("server_message_join_room", function(data) {
        let msg = (data.id === socket.id)
            ? "Bạn đã vào phòng " + data.room_name
            : data.player_name + " đã vào phòng " + data.room_name;
        addMessage_MCB('conv-room', 'Server', msg, true);
        addToast(msg, "info");
    });

    socket.on("server_message_leave_room", function(data) {
        let msg = (data.id === socket.id)
            ? "Bạn đã rời phòng " + data.room_name
            : data.player_name + " đã rời phòng " + data.room_name;
        addMessage_MCB('conv-room', 'Server', msg, true);
    });

    socket.on("server_send_online_count", function(online_count) {
        $("#online_count").text(online_count);
    });

    socket.on("server_send_message", function(data) {
        // Route: if sender is in a room AND receiver is in same room => room chat; else world
        let convId = data.room ? 'conv-room' : 'conv-world';
        addMessage_MCB(convId, data.from, data.mes, false);
        if (!document.hasFocus()) {
            let orig = document.title, n = 0;
            let interval = setInterval(() => {
                document.title = (n % 2 === 0) ? '💬 ' + data.from + ' nhắn tin' : orig;
                n++;
                if (n > 6) { clearInterval(interval); document.title = orig; }
            }, 800);
        }
    });

    socket.on("server_send_leave_room", function(reasonText) {
        roiPhong();
        Swal.fire({ icon: "info", title: reasonText });
    });

    // Player disconnected — show grace period countdown
    socket.on("server_player_disconnected", function(data) {
        let secs = Math.round(data.graceMs / 1000);
        addToast(`⚠️ ${data.name} mất kết nối. Chờ ${secs}s...`, "warning");
        showDisconnectBanner(data.name, secs);
    });

    // Player reconnected
    socket.on("server_player_reconnected", function(data) {
        addToast(`✅ ${data.name} đã kết nối lại!`, "success");
        hideDisconnectBanner();
    });

    // Game started — hide waiting overlay
    socket.on("server_game_start", function(data) {
        removeWaitingOverlay();
        _randomRoomWaiting = false;
    });
}

// ---- Disconnect Banner ----
let _disconnectBannerTimer = null;

function showDisconnectBanner(name, totalSecs) {
    let banner = document.getElementById('disconnectBanner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'disconnectBanner';
        banner.style.cssText = `
            position:fixed;top:60px;left:50%;transform:translateX(-50%);
            background:#ff6b35;color:#fff;padding:10px 24px;border-radius:8px;
            font-weight:bold;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.3);
            font-size:15px;display:flex;align-items:center;gap:10px;`;
        document.body.appendChild(banner);
    }
    let remaining = totalSecs;
    banner.innerHTML = `⚡ <span id="dcName">${name}</span> mất kết nối — thua sau <span id="dcCountdown">${remaining}</span>s`;
    banner.style.display = 'flex';

    if (_disconnectBannerTimer) clearInterval(_disconnectBannerTimer);
    _disconnectBannerTimer = setInterval(function() {
        remaining--;
        let el = document.getElementById('dcCountdown');
        if (el) el.textContent = remaining;
        if (remaining <= 0) hideDisconnectBanner();
    }, 1000);
}

function hideDisconnectBanner() {
    if (_disconnectBannerTimer) { clearInterval(_disconnectBannerTimer); _disconnectBannerTimer = null; }
    let banner = document.getElementById('disconnectBanner');
    if (banner) banner.style.display = 'none';
}

// ---------- Utilities ----------
function refreshData() { getOnlineCount(); getListRooms(); }

function getOnlineCount() {
    socket.emit("client_required_online_count", function(count) {
        $("#online_count").text(count);
    });
}

function getListRooms() {
    socket.emit("client_required_list_rooms", function(listRooms) {
        showListRooms(listRooms);
    });
}

function showListRooms(listRooms) {
    Rooms = listRooms || [];
    let count = Rooms.length;
    $("#roomsCount").text(count + " phòng");

    if (!count) {
        $("#tbRoomsBody").html(`
            <tr class="empty-row">
                <td colspan="5">
                    <div class="empty-state">
                        <i class="fas fa-ghost"></i>
                        <p>Chưa có phòng nào. Hãy tạo phòng đầu tiên!</p>
                    </div>
                </td>
            </tr>`);
        return;
    }

    let s = "";
    for (let d of Rooms) {
    let btnVao = '';
    let isFull = d.users_inroom >= (d.maxPlayers || 2);
    if (!isFull) {
        btnVao = d.pass
            ? `<button class="room-btn room-btn-key" onclick="checkVaoPhong('${d.name}')"><i class="fas fa-key"></i> Vào</button>`
            : `<button class="room-btn room-btn-join" onclick="vaoPhong('${d.name}')"><i class="fas fa-sign-in-alt"></i> Vào</button>`;
    } else {
        btnVao = `<span class="room-full-badge">Đầy</span>`;
    }

        let btnXoa = (d.owner && d.owner.name === player_name)
            ? `<button class="room-btn room-btn-delete" onclick="xoaPhong('${d.name}')"><i class="fas fa-trash-alt"></i></button>`
            : "";

        let passIcon = d.pass ? ' <i class="fas fa-lock" style="color:var(--gold);font-size:11px" title="Phòng có mật khẩu"></i>' : '';
        let spots = `${d.users_inroom}/${d.maxPlayers || 2}`;

        s += `<tr>
            <td><b>${escapeHtmlSafe(d.name)}</b>${passIcon}</td>
            <td>${escapeHtmlSafe(d.owner ? d.owner.name : "—")}</td>
            <td>${escapeHtmlSafe(d.preview || "")}</td>
            <td>${spots}</td>
            <td><div class="room-btn-group">${btnVao}${btnXoa}</div></td>
        </tr>`;
    }
    $("#tbRoomsBody").html(s);
}

function escapeHtmlSafe(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function addToast(message, type) {
    Swal.fire({
        toast: true, position: "top-end", icon: type || "info",
        title: message, timer: 2500, showConfirmButton: false, timerProgressBar: true
    });
}

// ---------- Tạo phòng ----------
function taoPhong() {
    Swal.mixin({
        allowEscapeKey: false, allowOutsideClick: false, showCloseButton: true,
        showCancelButton: true, cancelButtonColor: "#d33", reverseButtons: true,
        confirmButtonText: "Tiếp <i class='fas fa-arrow-right'></i>",
        cancelButtonText: "Hủy", progressSteps: ["1","2","3","4"]
    }).queue([
        { input:"password", title:"🔑 Mật khẩu phòng?", text:"Để trống nếu không cần mật khẩu." },
        { input:"text", title:"💬 Thông điệp?", inputAttributes:{maxlength:40}, text:"Mô tả ngắn gọn cho phòng của bạn." },
        { title:"👁️ Cho phép khán giả?", text:"Người xem có thể vào xem ván đang chơi.", input:"checkbox", inputValue:1, inputPlaceholder:"Cho phép khán giả vào xem" },
        { input:"text", title:"🚪 Tên phòng?", inputAttributes:{maxlength:24}, text:"Nhập tên phòng muốn tạo.",
          preConfirm: name => {
              if (!name || !name.trim()) return Swal.showValidationMessage("Tên phòng không được để trống!");
              if (name.indexOf("'") >= 0 || name.indexOf('"') >= 0) return Swal.showValidationMessage("Tên phòng không chứa ký tự nháy ' \"");
              for (let r of Rooms) { if (r.name === name) return Swal.showValidationMessage("Tên phòng đã tồn tại!"); }
              return name.trim();
          }
        }
    ]).then(result => {
        if (result.value) requestTaoPhong(result.value[3], result.value[0], result.value[1], result.value[2]);
    });
}

function requestTaoPhong(_name, _pass, _preview, _apceptViewer) {
    socket.emit("client_create_room",
        { name:_name, pass:_pass, preview:_preview, apceptViewer:_apceptViewer },
        function(isSuccess, errorText) {
            if (isSuccess) {
                Swal.fire({
                    icon:"success", title:"✅ Tạo phòng thành công!",
                    html:`<b>${_name}</b><br>Mật khẩu: ${_pass || "Không có"}`,
                    confirmButtonText:'<i class="fas fa-sign-in-alt"></i> Vào ngay',
                    showCancelButton:true, cancelButtonText:"Trở về"
                }).then(r => { if (r.value) vaoPhong(_name); });
            } else {
                Swal.fire({ icon:"error", title:"Lỗi", text:errorText || "Không thể tạo phòng" });
            }
        }
    );
}

function checkVaoPhong(name) {
    Swal.fire({
        icon:"warning", title:"🔑 Phòng có mật khẩu", text:"Vui lòng nhập mật khẩu để vào phòng",
        input:"password", confirmButtonText:"Vào phòng", showCancelButton:true,
        cancelButtonText:"Hủy", reverseButtons:true,
        preConfirm: pass => {
            socket.emit("client_required_join_room", name, pass, function(isSuccess) {
                if (isSuccess) { vaoPhong(name); Swal.close(); }
                else Swal.showValidationMessage("Sai mật khẩu!");
            });
            return false;
        }
    });
}

function vaoPhong(name) {
    socket.emit("client_join_room", name, function(isSuccess, errorText) {
        if (isSuccess) {
            for (let r of Rooms) { if (r.name === name) { currentRoom = r; break; } }
            $("#currentRoomName").text(name);
            sessionStorage.setItem('gomoku_room', name);
            openGame(true);
            if (_p5Instance) _p5Instance.remove();
            setTimeout(function() {
                _p5Instance = new p5(caro, "cnv");
                // Show waiting overlay if room not yet full
                socket.emit('client_required_list_rooms', function(rooms) {
                    let r = rooms.find(r => r.name === name);
                    if (r && r.users_inroom < 2) {
                        showWaitingOverlay("Đang chờ người chơi khác...");
                    }
                });
            }, 50);
        } else {
            if (errorText && errorText.includes('hết hạn')) {
                Swal.fire({ icon:"warning", title:"Phiên đăng nhập hết hạn", text:"Trang sẽ tải lại để đăng nhập lại.", confirmButtonText:"OK" })
                    .then(() => window.location.reload());
            } else {
                Swal.fire({ icon:"error", title:"Không thể vào phòng", text:errorText || name });
            }
        }
    });
}

function xacNhanRoiPhong() {
    Swal.fire({
        icon:"warning", title:"Rời phòng?",
        html:"Bạn có chắc muốn rời phòng <b>" + (currentRoom ? currentRoom.name : "") + "</b>?",
        showCancelButton:true, cancelButtonText:"Hủy",
        confirmButtonText:'<i class="fas fa-sign-out-alt"></i> Rời',
        confirmButtonColor:"#e84560"
    }).then(result => { if (result.value) roiPhong(); });
}

function roiPhong() {
    socket.emit("client_leave_room", function(isSuccess, errorText) {
        if (isSuccess) {
            if (_p5Instance) { _p5Instance.remove(); _p5Instance = null; }
            isSetupSocketEventCaro = false;
            currentRoom = null;
            sessionStorage.removeItem('gomoku_room');
            hideDisconnectBanner();
            openGame(false);
            addToast("Đã rời phòng", "info");
            refreshData();
        } else {
            Swal.fire({ icon:"error", title:errorText || "Không thể rời phòng" });
        }
    });
}

function xoaPhong(nameRoom) {
    Swal.fire({
        icon:"warning", title:"Xóa phòng " + nameRoom + "?",
        text:"Tất cả người chơi sẽ bị đưa ra sảnh.",
        showCancelButton:true, confirmButtonText:"Xóa phòng",
        confirmButtonColor:"#e84560", cancelButtonText:"Hủy", reverseButtons:true
    }).then(result => {
        if (result.value) {
            socket.emit("client_close_room", nameRoom, function(isSuccess, errorText) {
                if (isSuccess) addToast("Đã đóng phòng " + nameRoom, "success");
                else Swal.fire({ icon:"info", text:errorText });
            });
        }
    });
}

function openGame(trueFalse) {
    $(".game").css("display", trueFalse ? "block" : "none");
    $(".before-game").css("display", trueFalse ? "none" : "flex");
    if (!trueFalse) {
        $("#turnName").text("—");
        hideTimerBar();
        removeWaitingOverlay();
    }
}

// ---- Waiting Overlay ----
function showWaitingOverlay(text, subText) {
    let cnv = document.getElementById('cnv');
    if (!cnv) return;
    removeWaitingOverlay();
    let wo = document.createElement('div');
    wo.id = 'waitingOverlay';
    wo.className = 'waiting-overlay';
    wo.innerHTML = `
        <div class="waiting-dots">
            <span></span><span></span><span></span>
        </div>
        <div class="waiting-text">${text || 'Đang chờ...'}</div>
        ${subText ? `<div class="waiting-sub">${subText}</div>` : ''}
    `;
    cnv.appendChild(wo);
}

function removeWaitingOverlay() {
    let wo = document.getElementById('waitingOverlay');
    if (wo) wo.remove();
}

// ---- Random Room ----
let _randomRoomWaiting = false;

function joinRandomRoom() {
    if (_randomRoomWaiting) return;
    // Find an available room (not full, no password)
    let available = Rooms.filter(r => !r.pass && r.users_inroom < (r.maxPlayers || 2));
    if (available.length > 0) {
        // Pick random
        let pick = available[Math.floor(Math.random() * available.length)];
        vaoPhong(pick.name);
        return;
    }
    // No room available — create one and wait
    _randomRoomWaiting = true;
    let rndName = 'quick_' + Math.random().toString(36).slice(2,8);
    socket.emit('client_create_room', { name: rndName, pass: '', preview: 'Phòng ngẫu nhiên', apceptViewer: false }, function(ok) {
        if (ok) {
            vaoPhong(rndName);
            // Show waiting hint
            setTimeout(() => {
                showWaitingOverlay('Đang chờ đối thủ...', 'Hệ thống đã tạo phòng, chờ người khác vào');
            }, 200);
        } else {
            _randomRoomWaiting = false;
            Swal.fire({ icon:'error', title:'Không thể tạo phòng ngẫu nhiên' });
        }
    });
    // Reset flag after entering
    setTimeout(() => { _randomRoomWaiting = false; }, 5000);
}

// ============================================================
// caro.js — p5.js Game Engine + Timer + Win Animation
// ============================================================

if (typeof isSetupSocketEventCaro === 'undefined') {
    var isSetupSocketEventCaro = false;
}

// ========================= SOUND ENGINE =========================
const SFX = (() => {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    function resume() { if (ctx.state === 'suspended') ctx.resume(); }

    // Tạo âm từ Web Audio API — không cần file âm thanh ngoài
    function playTone(opts) {
        resume();
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type      = opts.type   || 'sine';
        osc.frequency.setValueAtTime(opts.freq || 440, ctx.currentTime);
        if (opts.freqEnd) osc.frequency.linearRampToValueAtTime(opts.freqEnd, ctx.currentTime + (opts.dur || 0.15));
        gain.gain.setValueAtTime(opts.vol || 0.25, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (opts.dur || 0.15));
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + (opts.dur || 0.15));
    }

    function playNoise(dur, vol) {
        resume();
        const bufSize = ctx.sampleRate * dur;
        const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
        const src  = ctx.createBufferSource();
        const gain = ctx.createGain();
        src.buffer = buf;
        src.connect(gain); gain.connect(ctx.destination);
        gain.gain.setValueAtTime(vol || 0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
        src.start(); src.stop(ctx.currentTime + dur);
    }

    return {
        // Đặt quân cờ — tiếng "gõ" nhẹ
        place() {
            playNoise(0.04, 0.18);
            playTone({ type: 'sine', freq: 800, freqEnd: 400, dur: 0.06, vol: 0.12 });
        },
        // Chiến thắng — fanfare
        win() {
            const notes = [523, 659, 784, 1047];
            notes.forEach((f, i) => {
                setTimeout(() => playTone({ type: 'triangle', freq: f, freqEnd: f * 1.02, dur: 0.22, vol: 0.3 }), i * 130);
            });
            setTimeout(() => playTone({ type: 'sine', freq: 1047, freqEnd: 1200, dur: 0.5, vol: 0.25 }), 560);
        },
        // Thua — âm xuống
        lose() {
            playTone({ type: 'sawtooth', freq: 330, freqEnd: 180, dur: 0.5, vol: 0.18 });
        },
        // Hết giờ — tiếng chuông cảnh báo
        timeout() {
            [880, 440].forEach((f, i) => {
                setTimeout(() => playTone({ type: 'square', freq: f, dur: 0.2, vol: 0.15 }), i * 220);
            });
        },
        // Đầu hàng
        surrender() {
            playTone({ type: 'triangle', freq: 300, freqEnd: 200, dur: 0.4, vol: 0.15 });
        },
        // Undo / ván mới
        undo() {
            playTone({ type: 'sine', freq: 600, freqEnd: 400, dur: 0.18, vol: 0.14 });
        },
        // Đối thủ disconnect
        disconnect() {
            playTone({ type: 'sine', freq: 400, freqEnd: 250, dur: 0.3, vol: 0.12 });
        },
        // Đồng hồ thấp — tick
        tick() {
            playTone({ type: 'square', freq: 1200, dur: 0.04, vol: 0.08 });
        }
    };
})();

// ========================= TIMER MODULE =========================
const TIMER_TOTAL_MS = 10 * 60 * 1000; // 10 minutes
const TIMER_LOW_SEC  = 30;              // threshold for bonus
const TIMER_BONUS_MS = 1000;            // +1s per move when low

let timerState = {
    active: false,
    timers: [TIMER_TOTAL_MS, TIMER_TOTAL_MS], // ms remaining per player
    currentPlayer: 0, // 0 or 1 (index in room players array)
    myIndex: -1,      // which index am I?
    playerNames: ['', ''],
    interval: null,
    lastTick: null
};

function timerStart(myIdx, player0Name, player1Name, histories) {
    timerState.myIndex = myIdx;
    timerState.playerNames = [player0Name, player1Name];
    timerState.active = true;
    timerState.timers = [TIMER_TOTAL_MS, TIMER_TOTAL_MS];
    // Figure turn from history length
    timerState.currentPlayer = histories.length % 2;
    timerStartTick();
    timerRender();
}

function timerStartTick() {
    if (timerState.interval) clearInterval(timerState.interval);
    timerState.lastTick = Date.now();
    timerState.interval = setInterval(timerTick, 200);
}

function timerTick() {
    if (!timerState.active) return;
    let now = Date.now();
    let elapsed = now - timerState.lastTick;
    timerState.lastTick = now;
    let cur = timerState.currentPlayer;
    timerState.timers[cur] -= elapsed;
    if (timerState.timers[cur] <= 0) {
        timerState.timers[cur] = 0;
        timerState.active = false;
        clearInterval(timerState.interval);
        timerRender();
        // Only I report if it's MY timer that ran out
        if (cur === timerState.myIndex) {
            socket.emit('client_timeout_lose');
        }
        return;
    }
    // Tick âm thanh khi còn ≤10s và là lượt của mình
    let secLeft = Math.ceil(timerState.timers[cur] / 1000);
    if (cur === timerState.myIndex && secLeft <= 10 && secLeft > 0) {
        // tick mỗi giây tròn
        let prevSec = Math.ceil((timerState.timers[cur] + elapsed) / 1000);
        if (prevSec !== secLeft) SFX.tick();
    }
    timerRender();
}

function timerOnMove(newCurrentPlayer) {
    // Called when a move is made — switch timer
    let prevPlayer = timerState.currentPlayer;
    // Bonus: if previous player had < 30s remaining, add 1s (but not if already >= 30s)
    if (timerState.timers[prevPlayer] < TIMER_LOW_SEC * 1000) {
        timerState.timers[prevPlayer] = Math.min(
            timerState.timers[prevPlayer] + TIMER_BONUS_MS,
            TIMER_LOW_SEC * 1000
        );
    }
    timerState.currentPlayer = newCurrentPlayer;
    timerState.lastTick = Date.now();
    timerRender();
}

function timerStop() {
    timerState.active = false;
    if (timerState.interval) { clearInterval(timerState.interval); timerState.interval = null; }
}

function timerReset(histories) {
    timerStop();
    timerState.timers = [TIMER_TOTAL_MS, TIMER_TOTAL_MS];
    timerState.currentPlayer = histories ? histories.length % 2 : 0;
    timerState.active = true;
    timerStartTick();
    timerRender();
}

function msToStr(ms) {
    if (ms <= 0) return '00:00';
    let total = Math.ceil(ms / 1000);
    let m = Math.floor(total / 60);
    let s = total % 60;
    return String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
}

function timerRender() {
    for (let i = 0; i < 2; i++) {
        let el = document.getElementById('timer_p' + i);
        if (!el) continue;
        let ms = timerState.timers[i];
        let str = msToStr(ms);
        el.textContent = str;
        let isLow = ms <= TIMER_LOW_SEC * 1000;
        let isActive = timerState.active && timerState.currentPlayer === i;
        el.className = 'player-timer' +
            (isActive ? ' timer-active' : '') +
            (isLow ? ' timer-low' : '');
    }
}

// ========================= WIN ANIMATION =========================
function showWinAnimation(winnerName, isMe) {
    // Overlay container
    let overlay = document.getElementById('winOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'winOverlay';
        document.body.appendChild(overlay);
    }

    overlay.innerHTML = '';
    overlay.style.cssText = `
        position:fixed;inset:0;z-index:10000;pointer-events:none;
        display:flex;align-items:center;justify-content:center;overflow:hidden;
        background:rgba(5,8,18,0.85);backdrop-filter:blur(8px);`;

    if (isMe) {
        // 🎉 Winner animation — light theme
        overlay.innerHTML = `
            <div id="winCard" style="
                pointer-events:all;
                background:linear-gradient(135deg,#1a1f35,#161b2e,#0d1020);
                border:1px solid rgba(245,200,66,0.4);
                border-radius:20px;padding:40px 60px;text-align:center;
                box-shadow:0 0 60px rgba(245,200,66,.2),0 8px 40px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,0.05);
                animation:winPop .5s cubic-bezier(.175,.885,.32,1.275) forwards;
                position:relative;overflow:hidden;">
                <div id="confettiCanvas" style="position:absolute;inset:0;pointer-events:none;"></div>
                <div style="position:absolute;inset:0;background:radial-gradient(ellipse at 50% 0%,rgba(245,200,66,.12),transparent 60%);pointer-events:none;"></div>
                <div style="font-size:72px;margin-bottom:16px;filter:drop-shadow(0 0 24px rgba(245,200,66,.7));animation:trophySpin 1s ease-out;position:relative;">🏆</div>
                <div style="font-size:28px;font-weight:900;background:linear-gradient(90deg,#f5c842,#fff,#f5c842);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin-bottom:10px;letter-spacing:3px;position:relative;">
                    CHIẾN THẮNG!
                </div>
                <div style="font-size:16px;color:#8899bb;margin-bottom:28px;position:relative;">
                    Chúc mừng <b style="color:#f5c842;text-shadow:0 0 10px rgba(245,200,66,.4)">${winnerName}</b> đã thắng ván này! 🎊
                </div>
                <div style="display:flex;gap:12px;justify-content:center;position:relative;">
                    <button onclick="closeWinOverlay()" style="
                        padding:11px 32px;border:none;border-radius:10px;cursor:pointer;
                        background:linear-gradient(135deg,#f5c842,#e6a817);color:#1a1200;font-weight:800;font-size:15px;
                        box-shadow:0 4px 16px rgba(245,200,66,.4);letter-spacing:0.5px;">
                        🎉 Tuyệt vời!
                    </button>
                </div>
            </div>`;

        // Spawn confetti
        spawnConfetti(overlay);
    } else {
        // 💀 Loser animation — light theme
        overlay.innerHTML = `
            <div id="winCard" style="
                pointer-events:all;
                background:linear-gradient(135deg,#1a0d10,#200f14,#0d0d0d);
                border:1px solid rgba(240,80,112,0.35);
                border-radius:20px;padding:40px 60px;text-align:center;
                box-shadow:0 0 50px rgba(240,80,112,.15),0 8px 40px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,0.04);
                animation:winPop .5s cubic-bezier(.175,.885,.32,1.275) forwards;position:relative;overflow:hidden;">
                <div style="position:absolute;inset:0;background:radial-gradient(ellipse at 50% 0%,rgba(240,80,112,.1),transparent 60%);pointer-events:none;"></div>
                <div style="font-size:72px;margin-bottom:16px;filter:drop-shadow(0 0 16px rgba(240,80,112,.5));position:relative;">💀</div>
                <div style="font-size:28px;font-weight:900;color:#f05070;margin-bottom:10px;letter-spacing:3px;text-shadow:0 0 20px rgba(240,80,112,.4);position:relative;">THUA RỒI!</div>
                <div style="font-size:16px;color:#8899bb;margin-bottom:28px;position:relative;">
                    <b style="color:#f05070">${winnerName}</b> đã thắng ván này.
                </div>
                <div style="display:flex;gap:12px;justify-content:center;position:relative;">
                    <button onclick="closeWinOverlay()" style="
                        padding:11px 28px;border:1px solid rgba(255,255,255,0.1);border-radius:10px;cursor:pointer;
                        background:rgba(255,255,255,0.06);color:#8899bb;font-weight:700;font-size:14px;">
                        Thôi kệ
                    </button>
                    <button onclick="closeWinOverlay();socket.emit('client_send_want_reset',player_name)" style="
                        padding:11px 28px;border:none;border-radius:10px;cursor:pointer;
                        background:linear-gradient(135deg,#f05070,#c0304f);color:#fff;font-weight:800;font-size:14px;
                        box-shadow:0 4px 14px rgba(240,80,112,.4);letter-spacing:0.5px;">
                        😤 Chơi lại
                    </button>
                </div>
            </div>`;
    }

    // Inject CSS animations once
    if (!document.getElementById('winAnimStyle')) {
        let style = document.createElement('style');
        style.id = 'winAnimStyle';
        style.textContent = `
            @keyframes winPop {
                0%{opacity:0;transform:scale(.3) rotate(-10deg)}
                60%{transform:scale(1.08) rotate(2deg)}
                100%{opacity:1;transform:scale(1) rotate(0deg)}
            }
            @keyframes trophySpin {
                0%{transform:rotate(-15deg) scale(.8)}
                60%{transform:rotate(8deg) scale(1.12)}
                100%{transform:rotate(0deg) scale(1)}
            }
            @keyframes confettiFall {
                0%{transform:translateY(-10px) rotate(0deg);opacity:1}
                100%{transform:translateY(600px) rotate(720deg);opacity:0}
            }
            .player-timer{font-size:22px;font-weight:bold;color:#4a5a7a;transition:color .3s,transform .1s;font-family:'Exo 2',sans-serif;}
            .player-timer.timer-active{color:#34d399;transform:scale(1.08);text-shadow:0 0 12px rgba(52,211,153,.4);}
            .player-timer.timer-low{color:#f05070 !important;animation:timerPulse .6s infinite alternate;}
            .player-timer.timer-active.timer-low{color:#f05070 !important;}
            @keyframes timerPulse{0%{opacity:1}100%{opacity:.4}}
        `;
        document.head.appendChild(style);
    }
}

function closeWinOverlay() {
    let o = document.getElementById('winOverlay');
    if (o) o.style.display = 'none';
}

function spawnConfetti(container) {
    const colors = ['#f5c842','#4f9eff','#34d399','#a78bfa','#f05070','#fff','#6ee7f7','#ff9f43','#fd79a8'];
    let canvas = document.getElementById('confettiCanvas');

    for (let i = 0; i < 80; i++) {
        setTimeout(function() {
            let el = document.createElement('div');
            let color = colors[Math.floor(Math.random() * colors.length)];
            let size = 6 + Math.random() * 10;
            let isCircle = Math.random() > .5;
            let startX = Math.random() * 100;
            let duration = 1.5 + Math.random() * 2;
            let delay = Math.random() * 2;
            el.style.cssText = `
                position:absolute;left:${startX}%;top:-20px;
                width:${size}px;height:${size}px;
                background:${color};
                border-radius:${isCircle ? '50%' : '2px'};
                animation:confettiFall ${duration}s ${delay}s ease-in forwards;
                pointer-events:none;`;
            if (canvas) canvas.appendChild(el);
        }, Math.random() * 500);
    }
}

// Timer UI injection
function injectTimerUI(p0Name, p1Name) {
    let timerBar = document.getElementById('timerBar');
    if (!timerBar) return; // should exist in HTML
    timerBar.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;">
            <span style="color:var(--text-secondary);font-size:13px;font-weight:600">${escapeHtmlSafe(p0Name)}</span>
            <span id="timer_p0" class="player-timer">10:00</span>
        </div>
        <div style="color:var(--text-muted);font-size:11px;letter-spacing:1px;font-weight:700">⏱ THỜI GIAN</div>
        <div style="display:flex;align-items:center;gap:10px;">
            <span id="timer_p1" class="player-timer">10:00</span>
            <span style="color:var(--text-secondary);font-size:13px;font-weight:600">${escapeHtmlSafe(p1Name)}</span>
        </div>`;
    timerBar.style.display = 'flex';
    // Shrink canvas to account for timer bar
    document.querySelector('.game') && document.querySelector('.game').classList.add('timer-active');
}

function hideTimerBar() {
    let t = document.getElementById('timerBar');
    if (t) t.style.display = 'none';
    document.querySelector('.game') && document.querySelector('.game').classList.remove('timer-active');
}

// ========================= CARO P5 =========================
let caro = function(p) {
    let game, theme, timeClick = 0, tableSize = 60;
    let _myPlayerIndex = -1; // 0 or 1

    p.setup = function() {
        if (!isSetupSocketEventCaro) setupSocketEvent();
        setupBtnEvent();

        p.createCanvas(p.windowWidth, p.windowHeight);
        p.pixelDensity(1);
        applyTheme("light");

        // Tự động chọn cellSize phù hợp màn hình
        let cellSize = Math.max(24, Math.min(36, Math.floor(Math.min(p.windowWidth, p.windowHeight) / 18)));
        game = new CaroTable(tableSize, tableSize, cellSize);
        game.moveToCenterPage();

        // If we have pending rejoin data, use it; otherwise request fresh
        if (window._pendingRejoinData) {
            let data = window._pendingRejoinData;
            window._pendingRejoinData = null;
            _applyHistoryAndTurn(data);
        } else {
            socket.emit('client_required_history_game', function(dataHistory, playerNames) {
                if (dataHistory !== false) {
                    game.reset();
                    game.history = dataHistory || [];
                    game.drawGrid();
                    game.drawData();
                    if (playerNames && playerNames.length === 2) {
                        _setupTimerForRoom(playerNames, game.history);
                    }
                } else {
                    Swal.fire({ icon:'error', title:'Không thể lấy dữ liệu trò chơi' });
                }
            });
        }
    };

    function _applyHistoryAndTurn(data) {
        let hist = data.history || [];
        let playerNames = data.players || [];
        let turnState = data.turnState || 'off';

        game.reset();
        game.history = hist;
        game.drawGrid();
        game.drawData();
        game.turn = (turnState === 'on');

        let spanTurn = document.getElementById('turnName');
        if (spanTurn) {
            spanTurn.innerHTML = game.turn
                ? 'Bạn: <b>' + game.getNextChar() + '</b>'
                : 'Đối thủ: <b>' + game.getNextChar() + '</b>';
        }

        if (playerNames.length === 2) {
            _setupTimerForRoom(playerNames, hist);
        }
    }

    function _setupTimerForRoom(playerNames, hist) {
        // Determine my index
        let myIdx = playerNames.indexOf(player_name);
        if (myIdx === -1) return; // I'm a viewer
        _myPlayerIndex = myIdx;
        injectTimerUI(playerNames[0], playerNames[1]);
        timerStart(myIdx, playerNames[0], playerNames[1], hist);
    }

    p.draw = function() {
        if (game) {
            p.background(theme.canvas_bg_color);
            game.run();
        }
    };

    p.mousePressed = function(e) { if (e.target.matches('canvas')) timeClick = p.millis(); };
    p.mouseReleased = function(e) { if (e.target.matches('canvas')) if (p.millis() - timeClick < 200) game.clicked(); };
    p.mouseDragged = function(e) {
        if (game && e.target.matches('canvas')) {
            e.preventDefault();
            game.focusTarget = false;
            game.pos.add(p.mouseX - p.pmouseX, p.mouseY - p.pmouseY);
        }
    };
    p.windowResized = function() {
        p.resizeCanvas(p.windowWidth, p.windowHeight, true);
        if (game) game.moveToCenterPage();
    };

    // ===================== TOUCH SUPPORT =====================
    let _touches = {};          // id -> {x,y}
    let _pinchDist0 = null;     // khoảng cách ban đầu khi pinch
    let _pinchCell0 = null;     // cellSize ban đầu khi pinch
    let _tapStart = 0;          // thời điểm touch start (ms)
    let _tapMoved = false;      // có drag không

    p.touchStarted = function(e) {
        let ts = e.touches;
        _touches = {};
        for (let t of ts) _touches[t.identifier] = {x: t.clientX, y: t.clientY};

        if (ts.length === 1) {
            _tapStart = p.millis();
            _tapMoved = false;
        }
        if (ts.length === 2) {
            _pinchDist0 = Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY);
            _pinchCell0 = game ? game.cellSize : 30;
        }
        return false; // prevent scroll
    };

    p.touchMoved = function(e) {
        let ts = e.touches;

        if (ts.length === 1 && game) {
            // Drag để cuộn bàn cờ
            let t = ts[0];
            let prev = _touches[t.identifier];
            if (prev) {
                let dx = t.clientX - prev.x;
                let dy = t.clientY - prev.y;
                if (Math.abs(dx) > 3 || Math.abs(dy) > 3) _tapMoved = true;
                game.focusTarget = false;
                game.pos.add(dx, dy);
            }
            _touches[t.identifier] = {x: t.clientX, y: t.clientY};
        }

        if (ts.length === 2 && game && _pinchDist0) {
            // Pinch để zoom
            let dist = Math.hypot(ts[0].clientX - ts[1].clientX, ts[0].clientY - ts[1].clientY);
            let scale = dist / _pinchDist0;
            let newSize = Math.round(_pinchCell0 * scale);
            newSize = Math.max(16, Math.min(60, newSize));
            if (newSize !== game.cellSize) {
                // Tâm zoom là giữa hai ngón tay
                let cx = (ts[0].clientX + ts[1].clientX) / 2;
                let cy = (ts[0].clientY + ts[1].clientY) / 2;
                let ratio = newSize / game.cellSize;
                game.pos.x = cx - (cx - game.pos.x) * ratio;
                game.pos.y = cy - (cy - game.pos.y) * ratio;
                game.cellSize = newSize;
                game.gra.resizeCanvas(game.cols * newSize, game.rows * newSize);
                game.drawGrid();
                game.drawData();
            }
            _tapMoved = true;
        }
        return false;
    };

    p.touchEnded = function(e) {
        // Nếu là tap ngắn (< 250ms, không drag) → đặt quân
        if (!_tapMoved && p.millis() - _tapStart < 250 && e.changedTouches.length > 0) {
            let t = e.changedTouches[0];
            // Lưu vị trí rồi gọi clicked với tọa độ touch
            let savedMX = p.mouseX, savedMY = p.mouseY;
            // Ghi đè tạm bằng vị trí touch (p5 không tự làm điều này cho touchEnded)
            p._mouseX = t.clientX;
            p._mouseY = t.clientY;
            if (game) game.clickedAt(t.clientX, t.clientY);
            p._mouseX = savedMX;
            p._mouseY = savedMY;
        }
        _pinchDist0 = null;
        return false;
    };

    // ===================== Button Events =====================
    function setupBtnEvent() {
        $('#btnNewGame').off('click').on('click', () => resetGame());
        $('#btnUndoGame').off('click').on('click', () => undoGame());
        $('#btnFocusPreMove').off('click').on('click', () => { if (game) game.focusToPreMove(); });
        $('#btnSwitchTheme').off('click').on('click', () => switchTheme());
        $('#btnLeaveRoom').off('click').on('click', () => xacNhanRoiPhong());
        $('#btnSurrender').off('click').on('click', () => surrenderGame());
    }

    function surrenderGame() {
        // Cho phép đầu hàng bất kỳ lúc nào khi đang trong ván đấu
        if (!game) {
            Swal.fire({ toast:true, position:"top-end", icon:"warning", title:"Chưa có ván đấu nào đang diễn ra!", timer:2000, showConfirmButton:false });
            return;
        }
        Swal.fire({
            icon:"warning", title:"🏳️ Đầu hàng?",
            html:"Bạn có chắc muốn <b>đầu hàng</b> không?<br>Đối thủ sẽ thắng ván này.<br><small style='color:#aaa'>Bạn vẫn ở lại phòng sau khi đầu hàng.</small>",
            confirmButtonText:'<i class="fas fa-flag"></i> Xác nhận đầu hàng',
            confirmButtonColor:'#e67e22',
            showCancelButton:true, cancelButtonText:'<i class="fas fa-times"></i> Hủy', reverseButtons:true
        }).then(result => {
            if (result.value) {
                socket.emit('client_surrender', player_name);
            }
        });
    }

    function resetGame() {
        Swal.fire({
            icon:"warning", title:"Ván mới?", text:"Bạn có chắc muốn tạo ván mới không?",
            confirmButtonText:'<i class="fas fa-rotate-left"></i> Tạo ván mới',
            showCancelButton:true, cancelButtonText:'Hủy', cancelButtonColor:'#d33', reverseButtons:true
        }).then(result => {
            if (result.value) {
                socket.emit('client_send_want_reset', player_name);
                Swal.fire({ icon:"info", title:"Đang chờ...", text:"Đang chờ người kia đồng ý tạo ván mới.",
                    timer:15000, showConfirmButton:false, timerProgressBar:true });
            }
        });
    }

    function undoGame() {
        socket.emit('client_send_want_undo', { from:player_name, isTurn:game.turn, id:socket.id });
        Swal.fire({ icon:"info", title:"Đang chờ...", text:"Đang chờ người kia đồng ý cho đánh lại.",
            timer:15000, showConfirmButton:false, timerProgressBar:true });
    }

    // ===================== Socket Events =====================
    function setupSocketEvent() {
        socket.on('server_send_clicked', function(data) {
            game.history.push(data);
            game.drawData();
            game.focusToPreMove();
            SFX.place();
            // Switch timer to my turn
            if (timerState.active) {
                timerOnMove(timerState.myIndex >= 0 ? timerState.myIndex : 0);
            }
        });

        socket.on('server_send_history', function(data) {
            game.reset(); game.history = data; game.drawGrid(); game.drawData();
        });

        socket.on('server_send_turn', function(data) {
            let spanTurn = document.getElementById('turnName');
            if (data === 'off') {
                game.turn = false;
                if (spanTurn) spanTurn.innerHTML = 'Đối thủ: <b>' + game.getNextChar() + '</b>';
                // Switch timer to opponent
                if (timerState.active && _myPlayerIndex >= 0) {
                    let oppIdx = 1 - _myPlayerIndex;
                    timerOnMove(oppIdx);
                }
            } else {
                game.turn = true;
                if (spanTurn) spanTurn.innerHTML = 'Bạn: <b>' + game.getNextChar() + '</b>';
                // Switch timer to me
                if (timerState.active && _myPlayerIndex >= 0) {
                    timerOnMove(_myPlayerIndex);
                }
            }
        });

        socket.on('server_game_start', function(data) {
            // Game just started (2 players joined)
            let playerNames = [data.player0, data.player1];
            _setupTimerForRoom(playerNames, game.history);
            // Hide waiting overlay
            let wo = document.getElementById('waitingOverlay');
            if (wo) wo.style.display = 'none';
        });

        socket.on('server_surrender', function(data) {
            // data: { surrenderedName, winnerName, winnerId }
            timerStop();
            let isWinner = socket.id === data.winnerId;
            // 1. Xóa bàn cờ ngay lập tức
            if (game) { game.reset(); }
            // 2. Âm thanh
            if (isWinner) SFX.win(); else SFX.surrender();
            showWinAnimation(data.winnerName, isWinner);
            addToast(`🏳️ ${data.surrenderedName} đã đầu hàng!`, "info");
        });

        socket.on('server_player_reconnected', function(data) {
            // Resume timer ticking
            if (!timerState.active && timerState.timers[0] > 0 && timerState.timers[1] > 0) {
                timerState.active = true;
                timerStartTick();
            }
            hideDisconnectBanner();
        });

        // Win
        socket.on('server_send_win', function(data) {
            timerStop();
            let isWinner = socket.id === data.id;
            // 1. Xóa bàn cờ ngay lập tức
            if (game) { game.reset(); }
            // 2. Âm thanh
            if (isWinner) SFX.win(); else SFX.lose();
            if (data.reason === 'leave') {
                let msg = isWinner ? '🚪 Đối thủ đã rời phòng — bạn thắng!' : '🚪 Bạn đã rời phòng — thua ván này.';
                addToast(msg, isWinner ? 'success' : 'warning');
            }
            showWinAnimation(data.name, isWinner);
        });

        // Undo flow
        socket.on('server_send_want_undo', function(data) {
            Swal.fire({
                allowEscapeKey:false, allowOutsideClick:false, icon:"question", title:"Xin đánh lại?",
                html:`<b>${data.from}</b> muốn đi lại bước vừa đánh.<br>Bạn có đồng ý không?`,
                confirmButtonText:'<i class="fas fa-check"></i> Đồng ý',
                showCancelButton:true, cancelButtonText:'<i class="fas fa-times"></i> Từ chối', reverseButtons:true
            }).then(isOke => {
                let soBuoc = data.isTurn ? 2 : 1;
                socket.emit('client_apcept_undo', { apcepted:!!isOke.value, soBuoc, from:player_name, id:data.id });
            });
        });

        socket.on('server_send_undo', function(data) {
            for (let i = 0; i < data.soBuoc; i++) game.undo();
            game.turn = (data.id === socket.id);
            let spanTurn = document.getElementById('turnName');
            if (spanTurn) spanTurn.innerHTML = game.turn
                ? 'Bạn: <b>' + game.getNextChar() + '</b>'
                : 'Đối thủ: <b>' + game.getNextChar() + '</b>';
            // Adjust timer current player based on who has turn now
            if (timerState.active && _myPlayerIndex >= 0) {
                timerState.currentPlayer = game.turn ? _myPlayerIndex : 1 - _myPlayerIndex;
            }
            SFX.undo();
            Swal.fire({ toast:true, position:"top-end", icon:"success", title:data.from+" đã chấp nhận đánh lại!", timer:2000, showConfirmButton:false });
        });

        socket.on('server_send_deny_undo', function(name) {
            Swal.fire({ toast:true, position:"top-end", icon:"warning", title:name+" không đồng ý đánh lại!", timer:2500, showConfirmButton:false });
        });

        // Reset flow
        socket.on('server_send_want_reset', function(name) {
            Swal.fire({
                allowEscapeKey:false, allowOutsideClick:false, icon:"question", title:"Ván mới?",
                html:`<b>${name}</b> muốn tạo ván mới.<br>Bạn có đồng ý không?`,
                confirmButtonText:'<i class="fas fa-check"></i> Đồng ý',
                showCancelButton:true, cancelButtonText:'<i class="fas fa-times"></i> Từ chối', reverseButtons:true
            }).then(isOke => {
                socket.emit('client_apcept_reset', { apcepted:!!isOke.value, from:player_name });
            });
        });

        socket.on('server_send_reset', function() {
            game.reset();
            document.getElementById('turnName').innerHTML = '—';
            closeWinOverlay();
            timerReset([]);
            SFX.undo();
            Swal.fire({ toast:true, position:"top-end", icon:"success", title:"Ván mới bắt đầu!", timer:2000, showConfirmButton:false });
        });

        socket.on('server_send_deny_reset', function(name) {
            Swal.fire({ toast:true, position:"top-end", icon:"warning", title:name+" không đồng ý ván mới!", timer:2500, showConfirmButton:false });
        });

        socket.on('server_timeout_lose', function(data) {
            timerStop();
            let isLoser = (data.loserName === player_name);
            // Xóa bàn cờ ngay lập tức
            if (game) { game.reset(); }
            // Âm thanh
            if (isLoser) { SFX.timeout(); SFX.lose(); } else { SFX.win(); }
            let winnerName = data.winnerName || (isLoser ? 'Đối thủ' : player_name);
            showWinAnimation(winnerName, !isLoser);
            addToast(isLoser ? '⏰ Hết giờ! Bạn thua.' : '⏰ Đối thủ hết giờ! Bạn thắng.', isLoser ? 'error' : 'success');
        });

        socket.on('server_player_disconnected', function(data) {
            SFX.disconnect();
        });

        isSetupSocketEventCaro = true;
    }

    // ===================== Theme =====================
    let themes = [
        { name:"dark", canvas_bg_color:"#0d1117", table_bg_color:"#161b27", table_stroke_color:"#304060",
          x_color:"#f05470", o_color:"#2ed886", x_hover_color:"#f0547066", o_hover_color:"#2ed88666",
          hightlight_cell_bg_color:"#5a9fff66", hightlight_cell_stroke_color:"#5a9fff",
          hover_cell_bg_color:"#1e2d48", hover_cell_stroke_color:"#3a5a9a",
          focus_cells_bg_color:"#5a9fff18", focus_cells_stroke_color:"#00000000" },
        { name:"light", canvas_bg_color:"#e8ecf5", table_bg_color:"#ffffff", table_stroke_color:"#a0aec0",
          x_color:"#d63651", o_color:"#1a9e61", x_hover_color:"#d6365155", o_hover_color:"#1a9e6155",
          hightlight_cell_bg_color:"#4f8ef744", hightlight_cell_stroke_color:"#2a5abf",
          hover_cell_bg_color:"#dde8ff", hover_cell_stroke_color:"#7090d0",
          focus_cells_bg_color:"#4f8ef718", focus_cells_stroke_color:"#00000000" },
        { name:"forest", canvas_bg_color:"#0a1208", table_bg_color:"#131f10", table_stroke_color:"#2a4a28",
          x_color:"#ff7040", o_color:"#6ee86e", x_hover_color:"#ff704066", o_hover_color:"#6ee86e66",
          hightlight_cell_bg_color:"#6ee86e44", hightlight_cell_stroke_color:"#6ee86e",
          hover_cell_bg_color:"#1a3018", hover_cell_stroke_color:"#3a6038",
          focus_cells_bg_color:"#6ee86e14", focus_cells_stroke_color:"#00000000" }
    ];

    function applyTheme(name) {
        for (let t of themes) { if (t.name === name) { theme = t; break; } }
        $('.ctrl-btn').css({'color':''});
    }

    function switchTheme() {
        let index = themes.findIndex(t => t.name === theme.name);
        index = (index+1) % themes.length;
        applyTheme(themes[index].name);
        if (game) { game.drawGrid(); game.drawData(); }
        addToast("Theme: " + themes[index].name, "info");
    }

    // ===================== CaroTable Class =====================
    class CaroTable {
        constructor(rows, cols, cSize) {
            this.pos = p.createVector(0,0);
            this.rows = rows; this.cols = cols; this.cellSize = cSize;
            this.gra = p.createGraphics(cols*cSize, rows*cSize);
            this.tableData = {}; this.history = [];
            this.target = p.createVector(0,0);
            this.focusTarget = false; this.turn = false;
            this.drawGrid(); this.resetData();
        }
        resetData() { this.tableData = {}; }
        reset() {
            this.focusTarget = false; this.turn = false;
            this.history = []; this.tableData = {};
            this.gra.resizeCanvas(this.cols*this.cellSize, this.rows*this.cellSize);
            this.drawGrid(); this.moveToCenterPage();
        }
        drawGrid() {
            this.gra.clear(); this.gra.background(theme.table_bg_color);
            this.gra.stroke(theme.table_stroke_color); this.gra.strokeWeight(1);
            for (let x=-.5; x<this.gra.width; x+=this.cellSize) this.gra.line(x,0,x,this.gra.height);
            for (let y=-.5; y<this.gra.height; y+=this.cellSize) this.gra.line(0,y,this.gra.width,y);
            let cx=Math.floor(this.cols/2), cy=Math.floor(this.rows/2);
            this.gra.fill(theme.table_stroke_color); this.gra.noStroke();
            this.gra.ellipse(cx*this.cellSize+this.cellSize/2, cy*this.cellSize+this.cellSize/2, 6,6);
        }
        drawData() { for (let d of this.history) this.setDataAt(d.col, d.row, d.data); }
        moveToCenterPage() {
            this.pos = p.createVector(-this.gra.width/2+p.width/2, -this.gra.height/2+p.height/2);
        }
        getDataAt(col,row) { if(this.tableData[row]) return this.tableData[row][col]||' '; return ' '; }
        setDataAt(col,row,data) {
            if(!this.tableData[row]) this.tableData[row]={};
            if(data!==' '){ this.tableData[row][col]=data; this.printChar(data,col,row,false,null); }
            else { delete this.tableData[row][col]; }
        }
        getIndexCellAt(posx,posy) {
            let col=p.floor((posx-this.pos.x)/this.cellSize);
            let row=p.floor((posy-this.pos.y)/this.cellSize);
            if(col<0||col>=this.cols) col=-1;
            if(row<0||row>=this.rows) row=-1;
            return {col,row};
        }
        getPosCellAt(col,row) { return {x:col*this.cellSize+this.pos.x, y:row*this.cellSize+this.pos.y}; }
        getCellAtIndex(col,row) { return {x:col*this.cellSize+this.pos.x, y:row*this.cellSize+this.pos.y, data:this.getDataAt(col,row)}; }
        switchChar(char) { return char==='X'?'O':'X'; }
        getNextChar() { let pre=this.getPreMove(); if(!pre) pre={data:'X'}; return this.switchChar(pre.data); }
        getPreMove() { return this.history[this.history.length-1]; }
        focusToCell(col,row) {
            let pos=this.getPosCellAt(col,row);
            this.target=p.createVector(this.pos.x-pos.x+p.width/2, this.pos.y-pos.y+p.height/3);
            this.focusTarget=true;
        }
        focusToPreMove() { let pre=this.getPreMove(); if(pre) this.focusToCell(pre.col,pre.row); }
        clickedAt(mx, my) {
            if(!this.turn) return;
            let index=this.getIndexCellAt(mx, my);
            if(index.col===-1||index.row===-1) return;
            if(this.getDataAt(index.col,index.row)!==' ') return;
            let nextChar=this.getNextChar();
            this.setDataAt(index.col,index.row,nextChar);
            let dataClicked={col:index.col,row:index.row,data:nextChar};
            this.history.push(dataClicked);
            SFX.place();
            socket.emit('client_clicked',dataClicked);
            if(timerState.active && _myPlayerIndex>=0) timerOnMove(1-_myPlayerIndex);
        }
        clicked() {
            if(!this.turn) return;
            if(p.mouseX<0||p.mouseX>p.width||p.mouseY<0||p.mouseY>p.height) return;
            let index=this.getIndexCellAt(p.mouseX,p.mouseY);
            if(index.col===-1||index.row===-1) return;
            if(this.getDataAt(index.col,index.row)!==' ') return;
            let nextChar=this.getNextChar();
            this.setDataAt(index.col,index.row,nextChar);
            let dataClicked={col:index.col,row:index.row,data:nextChar};
            this.history.push(dataClicked);
            SFX.place();
            socket.emit('client_clicked',dataClicked);
            // Switch timer to opponent
            if(timerState.active && _myPlayerIndex>=0) timerOnMove(1-_myPlayerIndex);
            let isWin=this.checkWin(index.col,index.row);
            if(isWin) { socket.emit('client_send_win',player_name); this.highlightWinLine(isWin.from,isWin.to); }
        }
        undo() {
            if(this.history.length) {
                let pre=this.history.pop();
                if(this.tableData[pre.row]) delete this.tableData[pre.row][pre.col];
                this.drawGrid(); this.drawData(); this.focusToPreMove();
            }
        }
        show() { p.image(this.gra,this.pos.x,this.pos.y,this.gra.width,this.gra.height); }
        showMousePos() {
            let index=this.getIndexCellAt(p.mouseX,p.mouseY);
            if(index.col===-1||index.row===-1){p.cursor(p.ARROW);return;}
            let cell=this.getCellAtIndex(index.col,index.row);
            if(this.turn){
                p.fill(theme.focus_cells_bg_color); p.noStroke();
                p.rect(cell.x,this.pos.y,this.cellSize,this.gra.height);
                p.rect(this.pos.x,cell.y,this.gra.width,this.cellSize);
                if(this.getDataAt(index.col,index.row)===' '){
                    p.fill(theme.hover_cell_bg_color); p.stroke(theme.hover_cell_stroke_color); p.strokeWeight(1);
                    p.rect(cell.x,cell.y,this.cellSize,this.cellSize);
                    let pre=this.getPreMove(); if(!pre) pre={data:'X'};
                    this.printChar(this.switchChar(pre.data),index.col,index.row,true,p);
                }
                p.cursor(p.HAND);
            } else { p.cursor(p.ARROW); }
        }
        hightlightPreMove() {
            let pre=this.getPreMove(); if(!pre) return;
            let pos=this.getPosCellAt(pre.col,pre.row);
            p.strokeWeight(2); p.fill(theme.hightlight_cell_bg_color); p.stroke(theme.hightlight_cell_stroke_color);
            p.rect(pos.x,pos.y,this.cellSize,this.cellSize);
            this.printChar(pre.data,pre.col,pre.row,false,p);
            p.strokeWeight(1);
        }
        highlightWinLine(from,to) {}
        printChar(char,col,row,alpha,cnv) {
            let c;
            if(cnv===p){ c=this.getPosCellAt(col,row); }
            else { c={x:col*this.cellSize, y:row*this.cellSize}; }
            cnv=cnv||this.gra;
            let strWei=3, del=strWei*3;
            cnv.noFill(); cnv.strokeWeight(strWei);
            if(char==='X'){
                cnv.stroke(alpha?theme.x_hover_color:theme.x_color);
                cnv.line(c.x+del,c.y+del,c.x+this.cellSize-del,c.y+this.cellSize-del);
                cnv.line(c.x+this.cellSize-del,c.y+del,c.x+del,c.y+this.cellSize-del);
            } else {
                cnv.stroke(alpha?theme.o_hover_color:theme.o_color);
                cnv.ellipse(c.x+this.cellSize/2,c.y+this.cellSize/2,this.cellSize-del*1.5,this.cellSize-del*1.5);
            }
            cnv.strokeWeight(1);
        }
        checkWin(col,row) {
            const dirs=[
                [{dc:-1,dr:0},{dc:1,dr:0}],
                [{dc:0,dr:-1},{dc:0,dr:1}],
                [{dc:-1,dr:-1},{dc:1,dr:1}],
                [{dc:1,dr:-1},{dc:-1,dr:1}]
            ];
            let cell={col,row,data:this.getDataAt(col,row)};
            for(let [from,to] of dirs){ let r=this.check(cell,from,to); if(r) return r; }
            return false;
        }
        check(cur,dFrom,dTo) {
            let data=cur.data, count=1, from=cur, to=cur, temp, d;
            while(true){ temp={col:from.col+dFrom.dc,row:from.row+dFrom.dr}; d=this.getDataAt(temp.col,temp.row); if(d!==data) break; from=temp; count++; }
            while(true){ temp={col:to.col+dTo.dc,row:to.row+dTo.dr}; d=this.getDataAt(temp.col,temp.row); if(d!==data) break; to=temp; count++; }
            if(count>=5) return {from,to}; return false;
        }
        controlMove() {
            if(p.keyIsDown(p.LEFT_ARROW)){this.pos.add(5,0);this.focusTarget=false;}
            if(p.keyIsDown(p.RIGHT_ARROW)){this.pos.add(-5,0);this.focusTarget=false;}
            if(p.keyIsDown(p.UP_ARROW)){this.pos.add(0,5);this.focusTarget=false;}
            if(p.keyIsDown(p.DOWN_ARROW)){this.pos.add(0,-5);this.focusTarget=false;}
        }
        run() {
            this.show(); this.showMousePos(); this.hightlightPreMove(); this.controlMove();
            if(this.focusTarget) this.pos=p5.Vector.lerp(this.pos,this.target||this.pos,.07);
            this.pos.x=p.constrain(this.pos.x,-this.gra.width+this.cellSize,p.width-this.cellSize);
            this.pos.y=p.constrain(this.pos.y,-this.gra.height+this.cellSize,p.height-this.cellSize);
        }
    }
};

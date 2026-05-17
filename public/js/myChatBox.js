// ============================================================
// myChatBox.js — Chat UI + Emoji
// ============================================================

function setupMyChatBox() {
    setupEmoji_MCB();
    showEmoji_MCB();
}

function setupEmoji_MCB() {
    updateFrequentlyFromLocal();

    // Đóng emoji khi click ngoài
    $(document).on('click', function(e) {
        let picker = document.getElementById('emoji-picker');
        if (!picker.contains(e.target) && e.target.id !== 'btn-emoji-picker') {
            picker.classList.remove("active");
        }
    });

    // Click emoji → chèn vào input
    $(document).on('click', '.emoji', function(e) {
        let inp = $('#input-message');
        inp.val(inp.val() + $(this).html());
        inp.focus();
        saveFrequentlyToLocal($(this).attr('title'), $(this).html());
    });

    // Click small title → load emoji
    $(document).on('click', '.emoji-picker-group-small-title', function(e) {
        addEmoji_MCB(e.target);
    });

    // Click big title → toggle nhóm con
    $(document).on('click', '.emoji-picker-group-title', function(e) {
        $(this).next('.emoji-picker-container-group-small').toggleClass('hide');
    });

    // Switch tab chat
    $(document).on('click', '#btns-choose-conv button', function(e) {
        let dataConv = $(this).attr('data-conv');
        if (dataConv) openChat_MCB($(this));
    });

    // Enter gửi tin
    $(document).on('keyup', '#input-message', function(event) {
        if (event.keyCode === 13) $('#btn-send-message').click();
    });

    // Nút gửi
    $(document).on('click', '#btn-send-message', function() {
        sendMessage_MCB();
    });

    // Đóng chat
    $(document).on('click', '#btn-close-chat', function() {
        $('#chatContainer').removeClass('active');
    });

    // Mở/đóng chat
    $(document).on('click', '#btn-open-chat', function() {
        $('#chatContainer').toggleClass('active');
        // Reset unread badge
        $('#unread-count').hide().text('0');
    });

    // Toggle emoji picker
    $(document).on('click', '#btn-emoji-picker', function(e) {
        e.stopPropagation();
        $('#emoji-picker').toggleClass("active");
    });

    // Search emoji
    $(document).on('keyup', '.emoji-input-search', function() {
        let val = $(this).val().toLowerCase();
        $('.emoji-picker-group-small-title').each(function() {
            $(this).toggle($(this).text().toLowerCase().indexOf(val) >= 0);
        });
    });
}

function openChat_MCB(btn) {
    $('#btns-choose-conv button').removeClass('active');
    btn.addClass('active');
    $('.conversation').removeClass('active');
    let idConv = btn.attr('data-conv');
    $('#' + idConv).addClass('active');
    // Reset badge for this tab
    if (idConv === 'conv-world') $('#badge-world').hide().text('0');
    if (idConv === 'conv-room') $('#badge-room').hide().text('0');
}

function sendMessage_MCB() {
    let inp = $('#input-message');
    let mes = inp.val().trim();
    if (!mes) return;

    // Lấy conversation đang active để xác định scope
    let activeConvId = $('.conversation.active').attr('id');
    let channel = (activeConvId === 'conv-room') ? 'room' : 'world';

    if (typeof socket !== 'undefined' && socket && typeof player_name !== 'undefined') {
        socket.emit('client_send_message', {
            mes: mes,
            from: player_name,
            channel: channel
        });
        // Also show own message locally
        addMessage_MCB(activeConvId, player_name, mes, false);
    }
    inp.val('');
}

/**
 * Thêm tin nhắn vào conversation
 * @param {string} containerID - 'conv-world' | 'conv-room'
 * @param {string} fromName - tên người gửi
 * @param {string} mes - nội dung tin nhắn
 * @param {boolean} isServer - tin hệ thống
 */
function addMessage_MCB(containerID, fromName, mes, isServer) {
    let container = $('#' + containerID);
    if (!container.length) return;

    let initials = isServer ? '🔔' : (fromName ? fromName.charAt(0).toUpperCase() : '?');
    let timeStr = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

    let rowClass = isServer ? 'msg-row msg-server' : 'msg-row';
    let div = $('<div></div>').addClass(rowClass);

    div.html(`
        <div class="msg-avatar">${initials}</div>
        <div class="msg-bubble">
            <div class="msg-name">${escapeHtml(fromName || 'Server')}</div>
            <div class="msg-text">${escapeHtml(mes)}</div>
            <div class="msg-time">${timeStr}</div>
        </div>
    `);

    container.append(div);

    // Auto-scroll
    container.animate({ scrollTop: container.prop("scrollHeight") }, 300);

    // Unread notification nếu chat đang đóng
    if (!$('#chatContainer').hasClass('active')) {
        let badge = $('#unread-count');
        let count = parseInt(badge.text()) || 0;
        badge.text(count + 1).show();
    } else {
        // Chat mở nhưng không phải tab active
        let activeTab = $('.chat-tab.active').attr('data-conv');
        if (activeTab !== containerID) {
            let tabBadge = containerID === 'conv-world' ? $('#badge-world') : $('#badge-room');
            let c = parseInt(tabBadge.text()) || 0;
            tabBadge.text(c + 1).show();
        }
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ========================= Emoji =======================
function showEmoji_MCB() {
    let s = '';
    for (let bighead in emojiJSON) {
        s += `<div class="emoji-picker-group">
            <div class="emoji-picker-group-title">${bighead}</div>
            <div class="emoji-picker-container-group-small hide">`;
        for (let smallhead in emojiJSON[bighead]) {
            s += `<p class="emoji-picker-group-small-title">${smallhead}</p>
                  <div class="emoji-container"></div>`;
        }
        s += `</div></div>`;
    }
    let groups = $('.emoji-picker-groups');
    groups.html(groups.html() + s);
}

function addEmoji_MCB(p) {
    if (window.event) window.event.stopPropagation();
    let div = p.nextElementSibling;
    let bighead = p.parentElement.parentElement.firstChild.innerHTML.trim().replace('&amp;', '&');
    let smallhead = p.innerHTML.trim().replace('&amp;', '&');
    if (!div.innerHTML) {
        let s = '';
        for (let emoji in emojiJSON[bighead][smallhead]) {
            s += `<span class="emoji" title="${emojiJSON[bighead][smallhead][emoji]}">${emoji}</span>`;
        }
        div.innerHTML = s;
    } else {
        div.innerHTML = '';
    }
}

function updateFrequentlyFromLocal() {
    let frequently = localStorage.getItem('emoji-frequently');
    if (!frequently) return;
    let emojis = JSON.parse(frequently);
    if (!emojis.length) return;
    let s = '<div class="emoji-picker-group-title">⭐ Dùng nhiều</div>';
    for (let e of emojis) {
        s += `<span class="emoji" title="${e.name}">${e.code}</span>`;
    }
    $('#frequently-used').html(s);
}

function saveFrequentlyToLocal(title, code) {
    let frequently = localStorage.getItem('emoji-frequently');
    let arr = frequently ? JSON.parse(frequently) : [];
    if (arr.find(f => f.code === code)) return;
    arr.unshift({ name: title, code: code });
    if (arr.length > 12) arr.pop();
    localStorage.setItem('emoji-frequently', JSON.stringify(arr));
}

// ========================= Emoji JSON =======================
let emojiJSON={"Smileys & Emotion":{"face-smiling":{"😀":"grinning face","😃":"grinning face with big eyes","😄":"grinning face with smiling eyes","😁":"beaming face with smiling eyes","😆":"grinning squinting face","😅":"grinning face with sweat","🤣":"rolling on the floor laughing","😂":"face with tears of joy","🙂":"slightly smiling face","🙃":"upside-down face","😉":"winking face","😊":"smiling face with smiling eyes","😇":"smiling face with halo"},"face-affection":{"😍":"smiling face with heart-eyes","🤩":"star-struck","😘":"face blowing a kiss","😗":"kissing face","😚":"kissing face with closed eyes","😙":"kissing face with smiling eyes"},"face-tongue":{"😋":"face savoring food","😛":"face with tongue","😜":"winking face with tongue","🤪":"zany face","😝":"squinting face with tongue","🤑":"money-mouth face"},"face-hand":{"🤗":"hugging face","🤭":"face with hand over mouth","🤫":"shushing face","🤔":"thinking face"},"face-neutral-skeptical":{"🤐":"zipper-mouth face","🤨":"face with raised eyebrow","😐":"neutral face","😑":"expressionless face","😶":"face without mouth","😏":"smirking face","😒":"unamused face","🙄":"face with rolling eyes","😬":"grimacing face","🤥":"lying face"},"face-sleepy":{"😌":"relieved face","😔":"pensive face","😪":"sleepy face","🤤":"drooling face","😴":"sleeping face"},"face-unwell":{"😷":"face with medical mask","🤒":"face with thermometer","🤕":"face with head-bandage","🤢":"nauseated face","🤮":"face vomiting","🤧":"sneezing face","😵":"dizzy face","🤯":"exploding head"},"face-hat":{"🤠":"cowboy hat face"},"face-glasses":{"😎":"smiling face with sunglasses","🤓":"nerd face","🧐":"face with monocle"},"face-concerned":{"😕":"confused face","😟":"worried face","🙁":"slightly frowning face","😮":"face with open mouth","😯":"hushed face","😲":"astonished face","😳":"flushed face","😦":"frowning face with open mouth","😧":"anguished face","😨":"fearful face","😰":"anxious face with sweat","😥":"sad but relieved face","😢":"crying face","😭":"loudly crying face","😱":"face screaming in fear","😖":"confounded face","😣":"persevering face","😞":"disappointed face","😓":"downcast face with sweat","😩":"weary face","😫":"tired face"},"face-negative":{"😤":"face with steam from nose","😡":"pouting face","😠":"angry face","🤬":"face with symbols on mouth","😈":"smiling face with horns","👿":"angry face with horns","💀":"skull"},"emotion":{"💋":"kiss mark","❤":"red heart","🧡":"orange heart","💛":"yellow heart","💚":"green heart","💙":"blue heart","💜":"purple heart","🖤":"black heart","💯":"hundred points","💢":"anger symbol","💥":"collision","💫":"dizzy","💦":"sweat droplets","💨":"dashing away","💬":"speech balloon","💭":"thought balloon","💤":"zzz"}},"People & Body":{"hand-fingers-open":{"👋":"waving hand","🤚":"raised back of hand","✋":"raised hand","🖖":"vulcan salute"},"hand-fingers-partial":{"👌":"OK hand","✌":"victory hand","🤞":"crossed fingers","🤟":"love-you gesture","🤘":"sign of the horns","🤙":"call me hand"},"hand-fingers-closed":{"👍":"thumbs up","👎":"thumbs down","✊":"raised fist","👊":"oncoming fist"}},"Activities":{"game":{"🎯":"direct hit","🎱":"pool 8 ball","🔮":"crystal ball","🎮":"video game","🕹":"joystick","🎰":"slot machine","🎲":"game die","♟":"chess pawn","🃏":"joker"},"sport":{"⚽":"soccer ball","🏀":"basketball","🏈":"american football","🎾":"tennis","🎳":"bowling","🏆":"trophy","🥇":"1st place medal","🥈":"2nd place medal","🥉":"3rd place medal"}},"Symbols":{"other-symbol":{"✅":"check mark button","❌":"cross mark","➕":"plus sign","➖":"minus sign","❓":"question mark","❗":"exclamation mark","🔴":"red circle","🔵":"blue circle","⚡":"high voltage","🔥":"fire","⭐":"star","🌟":"glowing star"}}};

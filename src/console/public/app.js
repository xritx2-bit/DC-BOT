// =========================================================
//  CYBER-DECK COMMAND CONSOLE CLIENT LOGIC
// =========================================================

document.addEventListener('DOMContentLoaded', () => {
  let socket = null;
  let sfxEnabled = true;
  let activeLogFilter = 'ALL';
  let autoscrollEnabled = true;
  let logsStore = [];
  let currentChatSessionId = null;
  let currentChatUserId = null;

  // ================= WEB AUDIO SYNTHESIZER =================
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  function playCyberTone(freq, type = 'sine', duration = 0.08) {
    if (!sfxEnabled) return;
    try {
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.04, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch (e) {}
  }

  function playCyberClick() { playCyberTone(1200, 'square', 0.04); }
  function playBeepSuccess() { playCyberTone(880, 'sine', 0.12); setTimeout(() => playCyberTone(1320, 'sine', 0.16), 80); }
  function playBeepError() { playCyberTone(240, 'sawtooth', 0.2); }

  // Sound FX Toggle
  const sfxBtn = document.getElementById('sfx-toggle-btn');
  const sfxIcon = document.getElementById('sfx-icon');
  if (sfxBtn) {
    sfxBtn.addEventListener('click', () => {
      sfxEnabled = !sfxEnabled;
      sfxIcon.textContent = sfxEnabled ? '🔊' : '🔇';
      if (sfxEnabled) playCyberClick();
    });
  }

  // Change Backend Relay URL button
  const changeRelayBtn = document.getElementById('change-relay-btn');
  if (changeRelayBtn) {
    changeRelayBtn.addEventListener('click', () => {
      const current = localStorage.getItem('abyss_relay_url') || window.location.origin;
      const next = prompt('Enter Railway Backend Relay URL (e.g. https://...up.railway.app):', current);
      if (next !== null) {
        localStorage.setItem('abyss_relay_url', next.trim());
        location.reload();
      }
    });
  }

  // ================= AUTHENTICATION MODAL =================
  const authModal = document.getElementById('auth-modal');
  const authForm = document.getElementById('auth-form');
  const authPassword = document.getElementById('auth-password');
  const authError = document.getElementById('auth-error');

  function getBackendUrl() {
    let saved = localStorage.getItem('abyss_relay_url');
    if (saved && saved.trim()) {
      saved = saved.trim().replace(/\/+$/, '');
      if (!saved.startsWith('http://') && !saved.startsWith('https://')) {
        saved = 'https://' + saved;
      }
      return saved;
    }
    return window.location.origin;
  }

  // Pre-fill relay URL input if stored
  const authRelayInput = document.getElementById('auth-relay-url');
  if (authRelayInput && localStorage.getItem('abyss_relay_url')) {
    authRelayInput.value = localStorage.getItem('abyss_relay_url');
  }

  const cachedToken = sessionStorage.getItem('cyber_deck_token');
  if (cachedToken) {
    authModal.classList.add('hidden');
    initSocketConnection();
  }

  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    authError.textContent = '';
    const pass = authPassword.value.trim();
    if (authRelayInput && authRelayInput.value.trim()) {
      localStorage.setItem('abyss_relay_url', authRelayInput.value.trim());
    } else {
      localStorage.removeItem('abyss_relay_url');
    }

    try {
      const backend = getBackendUrl();
      const res = await fetch(`${backend}/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pass })
      });
      const data = await res.json();

      if (data.success) {
        sessionStorage.setItem('cyber_deck_token', data.token);
        authModal.classList.add('hidden');
        playBeepSuccess();
        initSocketConnection();
      } else {
        authError.textContent = data.message || 'Passcode rejected.';
        playBeepError();
      }
    } catch (err) {
      authError.textContent = 'Relay communication error: ' + (err.message || 'Check Railway URL');
      playBeepError();
    }
  });

  // ================= TAB SWITCHING =================
  const tabButtons = document.querySelectorAll('.hud-tab');
  const tabViews = document.querySelectorAll('.tab-view');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      playCyberClick();
      tabButtons.forEach(b => b.classList.remove('active'));
      tabViews.forEach(v => v.classList.remove('active'));

      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab');
      const targetView = document.getElementById(targetId);
      if (targetView) targetView.classList.add('active');

      if (targetId === 'tab-embeds') {
        loadChannelsDropdown();
      }
      if (targetId === 'tab-telemetry') {
        loadInitialGuilds();
      }
    });
  });

  // ================= SOCKET.IO & TELEMETRY =================
  function initSocketConnection() {
    if (socket) return;
    const backend = getBackendUrl();
    socket = io(backend, { transports: ['websocket', 'polling'] });

    const wsStatusPill = document.getElementById('ws-latency-val');
    const termScreen = document.getElementById('terminal-screen');

    socket.on('connect', () => {
      wsStatusPill.textContent = 'ONLINE';
      wsStatusPill.style.color = 'var(--accent-green)';
      appendLogLine({
        timestamp: new Date().toTimeString().split(' ')[0],
        type: 'SYSTEM',
        message: 'Direct Quantum WebSocket link established.'
      });
      loadInitialGuilds();
      loadChannelsDropdown();
    });

    socket.on('disconnect', () => {
      wsStatusPill.textContent = 'OFFLINE';
      wsStatusPill.style.color = 'var(--accent-crimson)';
    });

    // Recent Logs buffer
    socket.on('recent_logs', logs => {
      logsStore = logs || [];
      renderAllLogs();
    });

    // Real-time new log event
    socket.on('new_log', logItem => {
      logsStore.push(logItem);
      if (logsStore.length > 400) logsStore.shift();
      appendLogLine(logItem);
    });

    // Real-time Telemetry Stream
    socket.on('telemetry', tele => {
      updateTelemetryUI(tele);
    });

    // Response from embed broadcast
    socket.on('embed_response', res => {
      const statusBox = document.getElementById('embed-dispatch-status');
      if (res.success) {
        statusBox.className = 'status-msg success';
        statusBox.textContent = `✓ Transmission Confirmed: ${res.message}`;
        playBeepSuccess();
      } else {
        statusBox.className = 'status-msg error';
        statusBox.textContent = `✗ Dispatch Failed: ${res.message}`;
        playBeepError();
      }
    });

    // Modmail reply status
    socket.on('modmail_reply_status', res => {
      if (res.success) {
        playBeepSuccess();
        const modalInput = document.getElementById('chat-modal-reply-input');
        if (modalInput) modalInput.value = '';
        const formInput = document.getElementById('modmail-reply-text');
        if (formInput) formInput.value = '';
      } else {
        alert('Failed to transmit message: ' + (res.error || 'Unknown error'));
        playBeepError();
      }
    });

    // Modmail conversation data stream
    socket.on('modmail_conversation_data', res => {
      renderConversationStream(res);
    });

    // Description update status
    socket.on('description_status', res => {
      const statusBox = document.getElementById('desc-status-msg');
      if (!statusBox) return;
      if (res.success) {
        statusBox.className = 'status-msg success';
        statusBox.textContent = '✓ Discord profile description updated successfully!';
        playBeepSuccess();
      } else {
        statusBox.className = 'status-msg error';
        statusBox.textContent = `✗ Update failed: ${res.error || 'Unknown error'}`;
        playBeepError();
      }
      setTimeout(() => { statusBox.style.display = 'none'; }, 4000);
    });
  }

  // ================= TELEMETRY UI UPDATER =================
  function updateTelemetryUI(tele) {
    // Header telemetry
    const botOnlineVal = document.getElementById('bot-online-val');
    const botStatusPip = document.getElementById('bot-status-pip');
    const uptimeVal = document.getElementById('uptime-val');

    if (tele.botDescription) {
      const descInput = document.getElementById('bot-description-input');
      if (descInput && !descInput.dataset.touched) {
        descInput.value = tele.botDescription;
      }
    }

    if (tele.online) {
      botOnlineVal.textContent = 'ONLINE';
      botOnlineVal.className = 'pill-val status-text online';
      botStatusPip.className = 'status-pip pulse-green';
    } else {
      botOnlineVal.textContent = 'AWAITING TOKEN';
      botOnlineVal.className = 'pill-val status-text offline';
      botStatusPip.className = 'status-pip pulse-red';
    }

    // Uptime formatter
    const s = tele.uptimeSeconds || 0;
    const h = String(Math.floor(s / 3600)).padStart(2, '0');
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const sec = String(s % 60).padStart(2, '0');
    uptimeVal.textContent = `${h}:${m}:${sec}`;

    // Telemetry Cards
    const cardPing = document.getElementById('card-ping');
    cardPing.textContent = tele.online ? `${tele.ping} ms` : '-- ms';

    const cardRam = document.getElementById('card-ram');
    cardRam.textContent = `${tele.ramUsedMb} MB`;
    const ramBar = document.getElementById('ram-progress-bar');
    const ramPercent = Math.min(100, Math.max(8, (parseFloat(tele.ramUsedMb) / 512) * 100));
    ramBar.style.width = `${ramPercent}%`;

    const cardTickets = document.getElementById('card-tickets');
    const activeTicketsCount = tele.activeTickets ? tele.activeTickets.length : 0;
    cardTickets.textContent = activeTicketsCount;

    const tabTicketBadge = document.getElementById('tab-ticket-badge');
    tabTicketBadge.textContent = activeTicketsCount;

    const cardVcs = document.getElementById('card-vcs');
    const activeVcsCount = tele.activeTempVcs ? tele.activeTempVcs.length : 0;
    cardVcs.textContent = activeVcsCount;

    // Matrix Identity Tab
    const matrixBotTag = document.getElementById('matrix-bot-tag');
    const matrixBotAvatar = document.getElementById('matrix-bot-avatar');
    const matrixStatusPill = document.getElementById('matrix-status-pill');
    const matrixGuildsCount = document.getElementById('matrix-guilds-count');
    const matrixMembersCount = document.getElementById('matrix-members-count');

    matrixBotTag.textContent = tele.botTag;
    if (tele.botAvatar) matrixBotAvatar.src = tele.botAvatar;
    matrixStatusPill.textContent = tele.online ? 'STATUS: ACTIVE & MONITORING' : 'STATUS: OFFLINE / CONFIGURING';
    matrixStatusPill.style.color = tele.online ? 'var(--accent-green)' : 'var(--accent-crimson)';

    matrixGuildsCount.textContent = tele.guildsCount;
    matrixMembersCount.textContent = tele.membersCount;

    // Matrix Tab - Connected Servers rendering
    renderGuildsList(tele.guilds || []);

    // Support Tab - Tickets rendering
    renderSupportTickets(tele.activeTickets || []);
    // Support Tab - Modmail rendering
    renderModmailSessions(tele.activeModmail || []);
    renderModmailArchive(tele.archivedModmail || []);
  }

  function renderGuildsList(guilds) {
    const container = document.getElementById('guilds-preview-list');
    if (!container) return;

    if (!guilds || guilds.length === 0) {
      container.innerHTML = '<div class="empty-state">No Discord servers registered yet. Invite ABYSS ENGINE to your server!</div>';
      return;
    }

    container.innerHTML = guilds.map(g => {
      const name = escapeHtml(g.name || 'Unnamed Server');
      const id = escapeHtml(g.id || '');
      const count = (g.memberCount || 0).toLocaleString();
      const initials = (name.split(/\s+/).map(w => w[0]).join('') || 'DC').slice(0, 3).toUpperCase();

      const iconHtml = g.icon
        ? `<img src="${g.icon}" alt="${name}" class="guild-icon" onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';" /><div class="guild-icon-placeholder" style="display:none;">${initials}</div>`
        : `<div class="guild-icon-placeholder">${initials}</div>`;

      return `
        <div class="guild-item">
          <div class="guild-left">
            ${iconHtml}
            <div class="guild-info">
              <span class="guild-name">${name}</span>
              <span class="guild-id">ID: ${id}</span>
            </div>
          </div>
          <div class="guild-badge">
            <span>👥</span>
            <span>${count} members</span>
          </div>
        </div>
      `;
    }).join('');
  }

  async function loadInitialGuilds() {
    try {
      const backend = getBackendUrl();
      const res = await fetch(`${backend}/api/guilds`);
      const data = await res.json();
      if (data && data.guilds) {
        renderGuildsList(data.guilds);
      }
    } catch (e) {}
  }

  function renderSupportTickets(tickets) {
    const container = document.getElementById('tickets-list-container');
    const countTag = document.getElementById('support-ticket-count');
    if (countTag) countTag.textContent = `${tickets.length} TICKETS`;

    if (!container) return;

    if (tickets.length === 0) {
      container.innerHTML = '<div class="empty-state">No active support tickets at this time.</div>';
      return;
    }

    container.innerHTML = tickets.map(t => `
      <div class="ticket-item">
        <div>
          <div class="ticket-info-title">#${t.channelId} • @${t.username}</div>
          <div class="ticket-meta">Category: ${t.category} | Created: ${t.createdAt.split('T')[1].slice(0, 8)}</div>
        </div>
        <button class="cyber-btn small danger-outline" onclick="closeTicketDirect('${t.channelId}')">CLOSE</button>
      </div>
    `).join('');
  }

  window.switchModmailView = function(view) {
    playCyberClick();
    const btnActive = document.getElementById('btn-show-active-modmail');
    const btnArchive = document.getElementById('btn-show-archive-modmail');
    const listActive = document.getElementById('modmail-list-container');
    const listArchive = document.getElementById('modmail-archive-container');
    const replyBox = document.getElementById('modmail-quick-reply-box');

    if (view === 'archive') {
      if (btnActive) btnActive.classList.remove('active');
      if (btnArchive) btnArchive.classList.add('active');
      if (listActive) listActive.style.display = 'none';
      if (replyBox) replyBox.style.display = 'none';
      if (listArchive) listArchive.style.display = 'flex';
    } else {
      if (btnActive) btnActive.classList.add('active');
      if (btnArchive) btnArchive.classList.remove('active');
      if (listActive) listActive.style.display = 'flex';
      if (replyBox) replyBox.style.display = 'block';
      if (listArchive) listArchive.style.display = 'none';
    }
  };

  function renderModmailSessions(sessions) {
    const container = document.getElementById('modmail-list-container');
    const countTag = document.getElementById('support-modmail-count');
    if (countTag) countTag.textContent = sessions.length;

    if (!container) return;

    if (sessions.length === 0) {
      container.innerHTML = '<div class="empty-state">No active DM modmail threads. When a member DMs ABYSS ENGINE, they will appear here!</div>';
      return;
    }

    container.innerHTML = sessions.map(m => {
      const guildName = escapeHtml(m.guildName || 'Unknown Server');
      const userDisplay = escapeHtml(m.username || m.userId);
      const timeDisplay = m.startedAt ? m.startedAt.split('T')[1].slice(0, 8) : '--:--:--';
      const msgCount = m.messageCount || 0;

      return `
        <div class="ticket-item" style="border-left-color: var(--accent-cyan);">
          <div>
            <div class="ticket-info-title">
              @${userDisplay} <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: normal;">(ID: ${m.userId})</span>
              <span class="server-badge">🌐 ${guildName}</span>
            </div>
            <div class="ticket-meta">Channel: #${m.channelId} | Since: ${timeDisplay} | Messages: ${msgCount}</div>
          </div>
          <div style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center;">
            <button class="cyber-btn small info-outline" onclick="openConversationModal('${m.id || m.userId}', '${m.userId}', '${userDisplay}')">VIEW TALK</button>
            <button class="cyber-btn small" onclick="setModmailReplyTarget('${m.userId}')">REPLY</button>
            <button class="cyber-btn small danger-outline" onclick="closeModmailDirect('${m.userId}')">CLOSE</button>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderModmailArchive(archived) {
    const container = document.getElementById('modmail-archive-container');
    const countTag = document.getElementById('support-modmail-archive-count');
    if (countTag) countTag.textContent = archived.length;

    if (!container) return;

    if (archived.length === 0) {
      container.innerHTML = '<div class="empty-state">No archived modmail history recorded yet. Past completed sessions will be saved here with full transcripts.</div>';
      return;
    }

    container.innerHTML = archived.map(m => {
      const guildName = escapeHtml(m.guildName || 'Unknown Server');
      const userDisplay = escapeHtml(m.username || m.userId);
      const closedAt = m.closedAt ? m.closedAt.replace('T', ' ').slice(0, 19) : 'Archived';
      const closedBy = escapeHtml(m.closedBy || 'Staff');
      const msgCount = m.messageCount || (m.messages ? m.messages.length : 0);

      return `
        <div class="ticket-item" style="border-left-color: var(--accent-magenta);">
          <div>
            <div class="ticket-info-title">
              @${userDisplay} <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: normal;">(ID: ${m.userId})</span>
              <span class="server-badge">🌐 ${guildName}</span>
            </div>
            <div class="ticket-meta">Closed: ${closedAt} by ${closedBy} | Messages: ${msgCount}</div>
          </div>
          <button class="cyber-btn small info-outline" onclick="openConversationModal('${m.id || m.userId}', '${m.userId}', '${userDisplay}')">TRANSCRIPT</button>
        </div>
      `;
    }).join('');
  }

  window.setModmailReplyTarget = function(userId) {
    playCyberClick();
    document.getElementById('modmail-user-id').value = userId;
    document.getElementById('modmail-reply-text').focus();
  };

  window.openConversationModal = function(sessionId, userId, username) {
    playCyberClick();
    currentChatSessionId = sessionId;
    currentChatUserId = userId;

    const modal = document.getElementById('modmail-chat-modal');
    const title = document.getElementById('chat-modal-title');
    const serverBadge = document.getElementById('chat-modal-server');
    const statusTag = document.getElementById('chat-modal-status');
    const meta = document.getElementById('chat-modal-meta');
    const stream = document.getElementById('chat-messages-stream');

    if (title) title.textContent = `📩 CONVERSATION // @${username || userId}`;
    if (serverBadge) serverBadge.textContent = 'CONNECTING...';
    if (statusTag) {
      statusTag.textContent = 'LOADING';
      statusTag.className = 'status-tag';
    }
    if (meta) meta.textContent = `User ID: ${userId} | Fetching live quantum transmission stream...`;
    if (stream) stream.innerHTML = '<div class="empty-state">Decrypting communications log...</div>';
    if (modal) modal.style.display = 'flex';

    if (socket) {
      socket.emit('get_modmail_conversation', { sessionId, userId });
    }
  };

  window.closeChatModal = function() {
    playCyberClick();
    const modal = document.getElementById('modmail-chat-modal');
    if (modal) modal.style.display = 'none';
    currentChatSessionId = null;
    currentChatUserId = null;
  };

  window.closeModmailDirect = function(userId) {
    playCyberClick();
    if (confirm(`Close and archive modmail session for user ${userId}? A transcript will be created.`)) {
      if (socket) {
        socket.emit('close_modmail', { userId });
      }
    }
  };

  function renderConversationStream(res) {
    if (!res || !res.success || !res.session) {
      const stream = document.getElementById('chat-messages-stream');
      if (stream) stream.innerHTML = '<div class="empty-state" style="color: var(--accent-crimson);">No conversation data available for this session.</div>';
      return;
    }

    const s = res.session;
    const serverBadge = document.getElementById('chat-modal-server');
    const statusTag = document.getElementById('chat-modal-status');
    const meta = document.getElementById('chat-modal-meta');
    const stream = document.getElementById('chat-messages-stream');
    const replyForm = document.getElementById('chat-modal-reply-form');

    if (serverBadge) serverBadge.textContent = `SERVER: ${s.guildName || 'Unknown Server'}`;
    if (statusTag) {
      const isActive = s.status === 'active';
      statusTag.textContent = isActive ? 'ACTIVE' : 'ARCHIVED';
      statusTag.className = `status-tag ${isActive ? 'online' : 'offline'}`;
      statusTag.style.color = isActive ? 'var(--accent-green)' : 'var(--accent-magenta)';
      statusTag.style.borderColor = isActive ? 'var(--accent-green)' : 'var(--accent-magenta)';
    }

    const started = s.startedAt ? s.startedAt.replace('T', ' ').slice(0, 19) : 'N/A';
    const closed = s.closedAt ? ` | Closed: ${s.closedAt.replace('T', ' ').slice(0, 19)} by ${escapeHtml(s.closedBy || 'Staff')}` : '';
    if (meta) {
      meta.textContent = `User: @${s.username || s.userId} (ID: ${s.userId}) | Started: ${started}${closed} | Messages: ${s.messages ? s.messages.length : 0}`;
    }

    if (replyForm) {
      replyForm.style.display = s.status === 'archived' ? 'none' : 'flex';
    }

    if (!s.messages || s.messages.length === 0) {
      if (stream) stream.innerHTML = '<div class="empty-state">No messages logged in this session yet.</div>';
      return;
    }

    if (stream) {
      stream.innerHTML = s.messages.map(msg => {
        const isUser = msg.senderType === 'user';
        const senderClass = isUser ? 'user' : 'staff';
        const senderTag = isUser ? `@${escapeHtml(msg.author)} (Member)` : `🛡️ ${escapeHtml(msg.author)} (Staff)`;
        const timeStr = msg.timestamp ? msg.timestamp.split('T')[1].slice(0, 8) : '--:--:--';
        const contentHtml = escapeHtml(msg.content || '');

        let attachHtml = '';
        if (msg.attachments && msg.attachments.length > 0) {
          attachHtml = `<div class="chat-attachments">` +
            msg.attachments.map(url => `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">📎 View Attachment</a>`).join('') +
            `</div>`;
        }

        return `
          <div class="chat-bubble ${senderClass}">
            <div class="chat-bubble-header">
              <span class="chat-author">${senderTag}</span>
              <span class="chat-time">${timeStr}</span>
            </div>
            <div class="chat-text">${contentHtml}</div>
            ${attachHtml}
          </div>
        `;
      }).join('');

      stream.scrollTop = stream.scrollHeight;
    }
  }

  window.closeTicketDirect = function(channelId) {
    playCyberClick();
    if (confirm('Close and delete this support ticket channel on Discord?')) {
      if (socket) {
        socket.emit('close_ticket', { channelId });
      }
    }
  };

  // ================= TERMINAL LOG RENDERING & FILTERS =================
  const termScreen = document.getElementById('terminal-screen');
  const filterButtons = document.querySelectorAll('.filter-btn');

  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      playCyberClick();
      filterButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeLogFilter = btn.getAttribute('data-filter');
      renderAllLogs();
    });
  });

  function appendLogLine(item) {
    if (!shouldShowLog(item, activeLogFilter)) return;

    const div = document.createElement('div');
    div.className = `log-line ${item.type.toLowerCase()}`;
    div.innerHTML = `
      <span class="log-time">[${item.timestamp}]</span>
      <span class="log-tag ${item.type}">[${item.type}]</span>
      <span class="log-msg">${escapeHtml(item.message)}</span>
    `;
    termScreen.appendChild(div);

    if (autoscrollEnabled) {
      termScreen.scrollTop = termScreen.scrollHeight;
    }
  }

  function renderAllLogs() {
    termScreen.innerHTML = '';
    const filtered = logsStore.filter(item => shouldShowLog(item, activeLogFilter));
    filtered.forEach(item => {
      const div = document.createElement('div');
      div.className = `log-line ${item.type.toLowerCase()}`;
      div.innerHTML = `
        <span class="log-time">[${item.timestamp}]</span>
        <span class="log-tag ${item.type}">[${item.type}]</span>
        <span class="log-msg">${escapeHtml(item.message)}</span>
      `;
      termScreen.appendChild(div);
    });
    if (autoscrollEnabled) {
      termScreen.scrollTop = termScreen.scrollHeight;
    }
  }

  function shouldShowLog(item, filter) {
    if (filter === 'ALL') return true;
    if (filter === 'ERROR') return item.type === 'ERROR' || item.type === 'WARN';
    return item.type === filter;
  }

  function escapeHtml(str) {
    return str.replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }

  // Clear Terminal
  document.getElementById('clear-term-btn').addEventListener('click', () => {
    playCyberClick();
    logsStore = [];
    termScreen.innerHTML = '';
  });

  // Autoscroll toggle
  const autoscrollBtn = document.getElementById('autoscroll-toggle-btn');
  autoscrollBtn.addEventListener('click', () => {
    autoscrollEnabled = !autoscrollEnabled;
    autoscrollBtn.classList.toggle('active', autoscrollEnabled);
    playCyberClick();
  });

  // Terminal Prompt Form Execution
  const promptForm = document.getElementById('terminal-prompt-form');
  const termInput = document.getElementById('term-input');

  promptForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const cmd = termInput.value.trim();
    if (!cmd) return;

    playCyberClick();
    if (socket) {
      socket.emit('execute_command', { command: cmd });
    }
    termInput.value = '';
  });

  // Macro Buttons
  document.querySelectorAll('.macro-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cmd = btn.getAttribute('data-cmd');
      if (cmd && socket) {
        playCyberClick();
        socket.emit('execute_command', { command: cmd });
      }
    });
  });

  // Restart Bot Button in Header
  document.getElementById('restart-bot-btn').addEventListener('click', () => {
    if (confirm('Engage reboot protocol for Discord bot engine?')) {
      playBeepSuccess();
      if (socket) socket.emit('execute_command', { command: 'restart' });
    }
  });

  // ================= EMBED BROADCASTER & PREVIEW =================
  const embedChanSelect = document.getElementById('embed-channel-select');
  const embedTitleInput = document.getElementById('embed-title');
  const embedColorInput = document.getElementById('embed-color');
  const embedDescInput = document.getElementById('embed-desc');
  const embedImageInput = document.getElementById('embed-image');
  const embedFooterInput = document.getElementById('embed-footer');

  // Preview elements
  const previewColorBar = document.getElementById('preview-color-bar');
  const previewTitle = document.getElementById('preview-title');
  const previewDesc = document.getElementById('preview-desc');
  const previewImg = document.getElementById('preview-img');
  const previewFooter = document.getElementById('preview-footer');

  function updateEmbedPreview() {
    previewColorBar.style.backgroundColor = embedColorInput.value;
    previewTitle.textContent = embedTitleInput.value || 'Untitled Transmission';
    previewDesc.innerHTML = escapeHtml(embedDescInput.value).replace(/\n/g, '<br>');
    previewFooter.textContent = embedFooterInput.value || '';

    if (embedImageInput.value) {
      previewImg.src = embedImageInput.value;
      previewImg.style.display = 'block';
    } else {
      previewImg.style.display = 'none';
    }
  }

  embedTitleInput.addEventListener('input', updateEmbedPreview);
  embedColorInput.addEventListener('input', updateEmbedPreview);
  embedDescInput.addEventListener('input', updateEmbedPreview);
  embedImageInput.addEventListener('input', updateEmbedPreview);
  embedFooterInput.addEventListener('input', updateEmbedPreview);

  // Color Swatches
  document.querySelectorAll('.color-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      const color = swatch.getAttribute('data-color');
      embedColorInput.value = color;
      updateEmbedPreview();
      playCyberClick();
    });
  });

  // Fetch Channels for Dropdown
  async function loadChannelsDropdown() {
    try {
      const backend = getBackendUrl();
      const res = await fetch(`${backend}/api/channels`);
      const data = await res.json();
      embedChanSelect.innerHTML = '<option value="">-- Select Channel --</option>';

      if (data.channels && data.channels.length > 0) {
        data.channels.forEach(ch => {
          const opt = document.createElement('option');
          opt.value = ch.id;
          opt.textContent = `#${ch.name} (${ch.guildName})`;
          embedChanSelect.appendChild(opt);
        });
      } else {
        const opt = document.createElement('option');
        opt.value = "";
        opt.textContent = "(No text channels detected - Invite bot to server)";
        embedChanSelect.appendChild(opt);
      }
    } catch (e) {}
  }

  // Submit Embed Broadcast
  document.getElementById('embed-dispatch-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const channelId = embedChanSelect.value;
    if (!channelId) {
      alert('Please select a target sector channel.');
      return;
    }

    playCyberClick();
    if (socket) {
      socket.emit('broadcast_embed', {
        channelId,
        title: embedTitleInput.value,
        description: embedDescInput.value,
        color: embedColorInput.value,
        imageUrl: embedImageInput.value,
        footer: embedFooterInput.value
      });
    }
  });

  // ================= MODMAIL DIRECT REPLY FORM =================
  document.getElementById('modmail-reply-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const userId = document.getElementById('modmail-user-id').value.trim();
    const text = document.getElementById('modmail-reply-text').value.trim();

    if (!userId || !text) return;
    playCyberClick();

    if (socket) {
      socket.emit('modmail_reply', { userId, text });
      document.getElementById('modmail-reply-text').value = '';
    }
  });

  window.applyStatusPreset = function(text) {
    playCyberClick();
    document.getElementById('activity-type').value = 'CUSTOM';
    document.getElementById('activity-text').value = text;
  };

  // ================= PRESENCE CONTROLLER =================
  document.getElementById('presence-form').addEventListener('submit', (e) => {
    e.preventDefault();
    playCyberClick();

    const selectedStatus = document.querySelector('input[name="presence_status"]:checked').value;
    const activityType = document.getElementById('activity-type').value;
    const activityText = document.getElementById('activity-text').value;
    const statusBox = document.getElementById('presence-status-msg');

    if (socket) {
      socket.emit('update_status', {
        status: selectedStatus,
        activityType,
        activityText
      });
      statusBox.className = 'status-msg success';
      statusBox.textContent = '✓ Presence protocol transmitted to Discord Gateway.';
      playBeepSuccess();
      setTimeout(() => { statusBox.style.display = 'none'; }, 4000);
    }
  });

  // ================= ABOUT ME / DESCRIPTION CONTROLLER =================
  const descInput = document.getElementById('bot-description-input');
  if (descInput) {
    descInput.addEventListener('input', () => {
      descInput.dataset.touched = 'true';
    });
  }

  const descForm = document.getElementById('description-form');
  if (descForm) {
    descForm.addEventListener('submit', (e) => {
      e.preventDefault();
      playCyberClick();
      const description = document.getElementById('bot-description-input').value.trim();
      if (socket) {
        socket.emit('update_description', { description });
      }
    });
  }

  // ================= CREDENTIALS VAULT =================
  document.getElementById('vault-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    playCyberClick();

    const token = document.getElementById('vault-token').value.trim();
    const clientId = document.getElementById('vault-client-id').value.trim();
    const statusMsg = document.getElementById('vault-status-msg');

    try {
      const backend = getBackendUrl();
      const res = await fetch(`${backend}/api/save-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, clientId })
      });
      const data = await res.json();

      if (data.success) {
        statusMsg.className = 'status-msg success';
        statusMsg.textContent = '✓ Credentials saved. Connecting to Discord Gateway...';
        playBeepSuccess();
        setTimeout(() => {
          const termTab = document.querySelector('.hud-tab[data-tab="tab-terminal"]');
          if (termTab) termTab.click();
        }, 1200);
      } else {
        statusMsg.className = 'status-msg error';
        statusMsg.textContent = '✗ Error: ' + data.error;
        playBeepError();
      }
    } catch (err) {
      statusMsg.className = 'status-msg error';
      statusMsg.textContent = '✗ Failed to communicate with server.';
      playBeepError();
    }
  });

  // ================= MODMAIL CONVERSATION MODAL INTERACTION =================
  const modalReplyForm = document.getElementById('chat-modal-reply-form');
  if (modalReplyForm) {
    modalReplyForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!currentChatUserId) return;
      const input = document.getElementById('chat-modal-reply-input');
      const text = input ? input.value.trim() : '';
      if (!text) return;

      playCyberClick();
      if (socket) {
        socket.emit('modmail_reply', { userId: currentChatUserId, text });
      }
    });
  }

  const modalCloseBtn = document.getElementById('chat-modal-close-btn');
  if (modalCloseBtn) {
    modalCloseBtn.addEventListener('click', () => {
      if (!currentChatUserId) return;
      if (confirm(`Close and archive modmail session for user ID ${currentChatUserId}? A transcript will be recorded.`)) {
        if (socket) {
          socket.emit('close_modmail', { userId: currentChatUserId });
          playBeepSuccess();
          closeChatModal();
        }
      }
    });
  }

  // Close modal on Escape or clicking backdrop
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('modmail-chat-modal');
      if (modal && modal.style.display !== 'none') {
        closeChatModal();
      }
    }
  });

  const modalOverlay = document.getElementById('modmail-chat-modal');
  if (modalOverlay) {
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) {
        closeChatModal();
      }
    });
  }
});

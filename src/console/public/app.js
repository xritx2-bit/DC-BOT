// =========================================================
//  CYBER-DECK COMMAND CONSOLE CLIENT LOGIC
// =========================================================

document.addEventListener('DOMContentLoaded', () => {
  let socket = null;
  let sfxEnabled = true;
  let activeLogFilter = 'ALL';
  let autoscrollEnabled = true;
  let logsStore = [];

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
    const saved = localStorage.getItem('abyss_relay_url');
    if (saved && saved.trim()) {
      return saved.trim().replace(/\/+$/, '');
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
        alert('Transmission dispatched to user direct messages.');
        playBeepSuccess();
      } else {
        alert('Failed to transmit message: ' + (res.error || 'Unknown error'));
        playBeepError();
      }
    });
  }

  // ================= TELEMETRY UI UPDATER =================
  function updateTelemetryUI(tele) {
    // Header telemetry
    const botOnlineVal = document.getElementById('bot-online-val');
    const botStatusPip = document.getElementById('bot-status-pip');
    const uptimeVal = document.getElementById('uptime-val');

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

    // Support Tab - Tickets rendering
    renderSupportTickets(tele.activeTickets || []);
    // Support Tab - Modmail rendering
    renderModmailSessions(tele.activeModmail || []);
  }

  function renderSupportTickets(tickets) {
    const container = document.getElementById('tickets-list-container');
    const countTag = document.getElementById('support-ticket-count');
    countTag.textContent = `${tickets.length} TICKETS`;

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

  function renderModmailSessions(sessions) {
    const container = document.getElementById('modmail-list-container');
    const countTag = document.getElementById('support-modmail-count');
    countTag.textContent = `${sessions.length} THREADS`;

    if (sessions.length === 0) {
      container.innerHTML = '<div class="empty-state">No active DM modmail threads. When a member DMs the bot, they will appear here!</div>';
      return;
    }

    container.innerHTML = sessions.map(m => `
      <div class="ticket-item" style="border-left-color: var(--accent-cyan);">
        <div>
          <div class="ticket-info-title">@${m.username} (ID: ${m.userId})</div>
          <div class="ticket-meta">Channel: #${m.channelId} | Since: ${m.startedAt.split('T')[1].slice(0, 8)}</div>
        </div>
        <button class="cyber-btn small" onclick="setModmailReplyTarget('${m.userId}')">REPLY</button>
      </div>
    `).join('');
  }

  window.setModmailReplyTarget = function(userId) {
    playCyberClick();
    document.getElementById('modmail-user-id').value = userId;
    document.getElementById('modmail-reply-text').focus();
  };

  window.closeTicketDirect = function(channelId) {
    playCyberClick();
    if (socket) {
      socket.emit('execute_command', { command: `say ${channelId} 🔒 *Ticket finalized via Cyber-Deck Command Console.*` });
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
        statusMsg.textContent = '✓ Credentials encrypted and written to .env. Bot engine restarting.';
        playBeepSuccess();
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
});

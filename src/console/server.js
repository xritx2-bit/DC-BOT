const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const fs = require('fs');
const cors = require('cors');
const logger = require('../utils/logger');
const config = require('../../config.json');
const { getActiveTickets, closeTicket, removeActiveTicket } = require('../handlers/ticketHandler');
const { getActiveSessions, sendDirectReplyFromConsole } = require('../handlers/modmailHandler');
const { getActiveTempVcs } = require('../handlers/tempVcHandler');
const { EmbedBuilder } = require('discord.js');

let ioInstance = null;

function startConsoleServer(initialClient, botManager) {
  const getClient = () => (botManager && botManager.client ? botManager.client : initialClient);

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: '*' }
  });
  ioInstance = io;

  const port = process.env.PORT || config.console.port || 3000;
  const password = process.env.CONSOLE_PASSWORD || 'cyber_admin_2026';

  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  // REST Auth Check
  app.post('/api/auth', (req, res) => {
    const { pass } = req.body;
    if (pass === password) {
      res.json({ success: true, token: 'cyber-' + Buffer.from(password).toString('base64') });
    } else {
      res.status(401).json({ success: false, message: 'Invalid Cyber-Deck access passcode.' });
    }
  });

  // REST Status / Health Check
  app.get('/api/status', (req, res) => {
    const curClient = getClient();
    const ready = !!(curClient && typeof curClient.isReady === 'function' && curClient.isReady());
    res.json({
      relay: 'ONLINE',
      hasToken: !!(process.env.DISCORD_TOKEN && process.env.DISCORD_TOKEN.trim()),
      engine: ready ? 'ONLINE' : 'AWAITING TOKEN',
      botTag: ready ? curClient.user.tag : null,
      ping: ready ? curClient.ws.ping : null,
      uptime: Math.floor(process.uptime())
    });
  });

  // REST Channels Fetch
  app.get('/api/channels', (req, res) => {
    const curClient = getClient();
    if (!curClient || !curClient.isReady()) {
      return res.json({ channels: [] });
    }
    const channels = [];
    curClient.guilds.cache.forEach(guild => {
      guild.channels.cache.forEach(chan => {
        if (chan.isTextBased()) {
          channels.push({
            id: chan.id,
            name: chan.name,
            guildName: guild.name,
            guildId: guild.id
          });
        }
      });
    });
    res.json({ channels });
  });

  // REST Guilds Fetch
  app.get('/api/guilds', (req, res) => {
    const curClient = getClient();
    if (!curClient || !curClient.isReady()) {
      return res.json({ guilds: [] });
    }
    const guilds = curClient.guilds.cache.map(g => ({
      id: g.id,
      name: g.name,
      memberCount: g.memberCount,
      icon: g.iconURL({ dynamic: true })
    }));
    res.json({ guilds });
  });

  // Save Token to .env via Console if needed
  app.post('/api/save-token', async (req, res) => {
    const { token, clientId } = req.body;
    if (!token) return res.status(400).json({ error: 'Token is required' });

    try {
      const envPath = path.join(__dirname, '../../.env');
      let envContent = '';
      if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf8');
      }

      // Replace or append
      if (envContent.includes('DISCORD_TOKEN=')) {
        envContent = envContent.replace(/DISCORD_TOKEN=.*(?:\r?\n|$)/, `DISCORD_TOKEN=${token}\n`);
      } else {
        envContent += `\nDISCORD_TOKEN=${token}`;
      }

      if (clientId) {
        if (envContent.includes('CLIENT_ID=')) {
          envContent = envContent.replace(/CLIENT_ID=.*(?:\r?\n|$)/, `CLIENT_ID=${clientId}\n`);
        } else {
          envContent += `\nCLIENT_ID=${clientId}`;
        }
      }

      fs.writeFileSync(envPath, envContent, 'utf8');
      process.env.DISCORD_TOKEN = token;
      if (clientId) process.env.CLIENT_ID = clientId;
      logger.system('Bot token updated via Cyber-Deck console. Restarting bot client...');

      if (botManager && botManager.restartBot) {
        botManager.restartBot().catch(err => {
          logger.error(`Engine restart error: ${err.message}`);
        });
      }

      // Immediately broadcast fresh telemetry to all clients after reboot delay
      setTimeout(() => {
        sendTelemetry(io, getClient);
      }, 1500);

      res.json({ success: true, message: 'Configuration written. Bot restarting.' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Socket.IO Connections
  io.on('connection', socket => {
    logger.console(`Cyber-Deck console client linked (Socket ID: ${socket.id})`);

    // Send recent logs buffer immediately
    socket.emit('recent_logs', logger.getRecentLogs());

    // Send initial telemetry
    sendTelemetry(socket, getClient);

    // Terminal Command Execution
    socket.on('execute_command', async data => {
      const { command } = data;
      if (!command) return;

      logger.console(`[CONSOLE INPUT] > ${command}`);

      const parts = command.trim().split(/ +/);
      const cmd = parts[0].toLowerCase();
      const args = parts.slice(1);

      try {
        if (cmd === 'help') {
          logger.console('Available Console Commands:');
          logger.console('  status <online|idle|dnd> [activity text]');
          logger.console('  say <channelId> <message>');
          logger.console('  tickets');
          logger.console('  modmail');
          logger.console('  restart');
          logger.console('  ping');
          logger.console('  clear');
          return;
        }

        if (cmd === 'ping') {
          const curClient = getClient();
          const ping = curClient && curClient.isReady() ? curClient.ws.ping : 'N/A';
          logger.console(`Discord Gateway Heartbeat: ${ping}ms | Process Uptime: ${Math.floor(process.uptime())}s`);
          return;
        }

        if (cmd === 'restart') {
          logger.console('Initiating bot engine reboot...');
          if (botManager && botManager.restartBot) {
            botManager.restartBot();
          }
          return;
        }

        if (cmd === 'tickets') {
          const t = getActiveTickets(getClient());
          logger.console(`Active Support Tickets (${t.length}):`);
          t.forEach(item => logger.console(` - #${item.channelId} | User: @${item.username} | Cat: ${item.category}`));
          return;
        }

        if (cmd === 'modmail') {
          const m = getActiveSessions(getClient());
          logger.console(`Active Modmail Sessions (${m.length}):`);
          m.forEach(item => logger.console(` - User: @${item.username} (ID: ${item.userId})`));
          return;
        }

        if (cmd === 'say') {
          const curClient = getClient();
          if (!curClient || !curClient.isReady()) {
            logger.error('Discord client is not ready to broadcast.');
            return;
          }
          const channelId = args[0];
          const text = args.slice(1).join(' ');
          const chan = curClient.channels.cache.get(channelId);
          if (!chan) {
            logger.error(`Channel ID "${channelId}" not found in cache.`);
            return;
          }
          await chan.send(text);
          logger.console(`Broadcast dispatched to #${chan.name}`);
          return;
        }

        if (cmd === 'status') {
          const curClient = getClient();
          if (!curClient || !curClient.isReady()) {
            logger.error('Discord client is not online.');
            return;
          }
          const presence = args[0] || 'online';
          const actText = args.slice(1).join(' ') || config.bot.statusText;
          curClient.user.setPresence({
            status: presence,
            activities: [{ name: actText }]
          });
          logger.console(`Presence synchronized: ${presence.toUpperCase()} - "${actText}"`);
          return;
        }

        logger.warn(`Unrecognized console directive: "${command}". Type "help" for syntax.`);
      } catch (err) {
        logger.error(`Console execution error: ${err.message}`);
      }
    });

    // Update Status from UI controls
    socket.on('update_status', data => {
      const curClient = getClient();
      if (!curClient || !curClient.isReady()) return;
      const { status, activityType, activityText } = data;
      try {
        const typeMap = {
          PLAYING: 0,
          STREAMING: 1,
          LISTENING: 2,
          WATCHING: 3,
          CUSTOM: 4,
          COMPETING: 5
        };

        const actType = typeMap[activityType] !== undefined ? typeMap[activityType] : 4;
        const text = activityText || config.bot.statusText;

        curClient.user.setPresence({
          status: status || 'online',
          activities: [
            {
              name: text,
              state: text,
              type: actType
            }
          ]
        });
        logger.system(`Status overridden via Cyber-Deck: [${status}] ${activityType}: ${text}`);
      } catch (e) {
        logger.error(`Failed to update status: ${e.message}`);
      }
    });

    // Update Application Description (About Me)
    socket.on('update_description', async data => {
      const curClient = getClient();
      if (!curClient || !curClient.isReady()) {
        socket.emit('description_status', { success: false, error: 'Discord engine offline.' });
        return;
      }
      const { description } = data;
      try {
        await curClient.application.fetch();
        await curClient.application.edit({ description });
        logger.system(`Bot profile "About Me" description updated via Cyber-Deck.`);
        socket.emit('description_status', { success: true, message: 'Discord profile description updated successfully.' });
      } catch (e) {
        logger.error(`Failed to update application description: ${e.message}`);
        socket.emit('description_status', { success: false, error: e.message });
      }
    });

    // Broadcast Rich Embed from Cyber-Deck UI
    socket.on('broadcast_embed', async data => {
      const curClient = getClient();
      if (!curClient || !curClient.isReady()) {
        socket.emit('embed_response', { success: false, message: 'Discord engine offline.' });
        return;
      }
      const { channelId, title, description, color, imageUrl, footer } = data;
      const chan = curClient.channels.cache.get(channelId);
      if (!chan) {
        socket.emit('embed_response', { success: false, message: 'Target channel not found.' });
        return;
      }

      try {
        const embed = new EmbedBuilder()
          .setColor(color ? parseInt(color.replace('#', ''), 16) : 0xFF1E27)
          .setTitle(title || `⚡ ${config.bot.name || 'CYBER ENGINE'} TRANSMISSION`)
          .setDescription(description || '')
          .setTimestamp();

        if (imageUrl) embed.setImage(imageUrl);
        if (footer) embed.setFooter({ text: footer });

        await chan.send({ embeds: [embed] });
        logger.discord(`Broadcasted custom Cyber-Deck embed to #${chan.name}`);
        socket.emit('embed_response', { success: true, message: `Dispatched to #${chan.name}` });
      } catch (err) {
        logger.error(`Embed broadcast failed: ${err.message}`);
        socket.emit('embed_response', { success: false, message: err.message });
      }
    });

    // Modmail Direct Reply from Cyber-Deck
    socket.on('modmail_reply', async data => {
      const curClient = getClient();
      if (!curClient || !curClient.isReady()) return;
      const { userId, text } = data;
      try {
        await sendDirectReplyFromConsole(curClient, userId, text);
        socket.emit('modmail_reply_status', { success: true });
      } catch (err) {
        socket.emit('modmail_reply_status', { success: false, error: err.message });
      }
    });

    // Close Support Ticket from Cyber-Deck UI
    socket.on('close_ticket', async data => {
      const curClient = getClient();
      const { channelId } = data;
      if (!channelId || !curClient || !curClient.isReady()) return;
      try {
        const chan = curClient.channels.cache.get(channelId);
        if (chan) {
          await closeTicket(chan, 'Cyber-Deck Console');
          io.emit('new_log', {
            type: 'TICKET',
            message: `Ticket #${chan.name} finalized and closed via Cyber-Deck Console`,
            timestamp: new Date().toTimeString().split(' ')[0]
          });
        } else {
          removeActiveTicket(channelId);
        }
        sendTelemetry(io, getClient);
      } catch (err) {
        logger.error(`Failed to close ticket from console: ${err.message}`);
      }
    });
  });

  // Listen to logger events and stream to connected WebSocket clients
  logger.on('log', logItem => {
    io.emit('new_log', logItem);
  });

  // Telemetry Interval (every 2 seconds)
  setInterval(() => {
    sendTelemetry(io, getClient);
  }, 2000);

  server.listen(port, '0.0.0.0', () => {
    logger.console(`⚡ CYBER-DECK COMMAND CONSOLE ONLINE at http://0.0.0.0:${port}`);
  });

  return { app, server, io };
}

function sendTelemetry(target, clientSource) {
  const mem = process.memoryUsage();
  const client = typeof clientSource === 'function' ? clientSource() : clientSource;
  const clientReady = client && typeof client.isReady === 'function' && client.isReady();

  const telemetry = {
    online: !!clientReady,
    botTag: clientReady ? client.user.tag : 'DISCORD_DISCONNECTED',
    botAvatar: clientReady ? client.user.displayAvatarURL() : null,
    uptimeSeconds: Math.floor(process.uptime()),
    ramUsedMb: (mem.heapUsed / 1024 / 1024).toFixed(1),
    ramTotalMb: (os.totalmem() / 1024 / 1024 / 1024).toFixed(1),
    cpuLoad: os.loadavg()[0] ? os.loadavg()[0].toFixed(2) : '0.12',
    ping: clientReady ? (client.ws.ping >= 0 ? client.ws.ping : 0) : 0,
    guildsCount: clientReady ? client.guilds.cache.size : 0,
    membersCount: clientReady ? client.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0) : 0,
    activeTickets: getActiveTickets(client),
    activeModmail: getActiveSessions(client),
    activeTempVcs: getActiveTempVcs(),
    botDescription: clientReady && client.application ? client.application.description : (config.bot.description || '')
  };

  target.emit('telemetry', telemetry);
}

module.exports = {
  startConsoleServer
};

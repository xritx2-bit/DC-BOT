require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  ActivityType
} = require('discord.js');
const config = require('../config.json');
const logger = require('./utils/logger');
const { handleCommand } = require('./commands');
const { handleTicketButton, handleChannelDelete } = require('./handlers/ticketHandler');
const { handleDirectMessage, handleStaffReply, handleModmailChannelDelete } = require('./handlers/modmailHandler');
const { handleVoiceStateUpdate } = require('./handlers/tempVcHandler');
const { startConsoleServer } = require('./console/server');

class BotManager {
  constructor() {
    this.client = null;
    this.consoleInstance = null;
  }

  createClient() {
    return new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.DirectMessages
      ],
      partials: [
        Partials.Channel,
        Partials.Message,
        Partials.User
      ]
    });
  }

  init() {
    const botName = config.bot.name || 'NEXUS ENGINE';
    const tagline = config.bot.tagline || 'Next-Gen Autonomous Support & Server Operations';
    logger.system('⚡ ======================================================== ⚡');
    logger.system(`   ${botName} // FUTURISTIC DISCORD BOT & CYBER-DECK       `);
    logger.system(`   "${tagline}"                                           `);
    logger.system('⚡ ======================================================== ⚡');

    this.client = this.createClient();
    this.setupEventHandlers();

    // Start Web Console Server first
    this.consoleInstance = startConsoleServer(this.client, this);

    // Connect to Discord Gateway
    this.connectDiscord();
  }

  setupEventHandlers() {
    const client = this.client;

    client.on('ready', () => {
      logger.discord(`Discord Engine Authorized as: ${client.user.tag} (ID: ${client.user.id})`);
      logger.discord(`Monitoring ${client.guilds.cache.size} server(s) across the grid.`);

      // Set initial futuristic status
      try {
        const typeMap = {
          PLAYING: ActivityType.Playing,
          STREAMING: ActivityType.Streaming,
          LISTENING: ActivityType.Listening,
          WATCHING: ActivityType.Watching,
          CUSTOM: ActivityType.Custom,
          COMPETING: ActivityType.Competing
        };

        const chosenType = typeMap[config.bot.statusType] !== undefined ? typeMap[config.bot.statusType] : ActivityType.Custom;
        const guildCount = client.guilds.cache.size.toLocaleString();
        const serverWord = (guildCount === '1' || guildCount === 1) ? 'server' : 'servers';
        const rawStatus = config.bot.statusText || '?help — abyss.gg — {servers}';
        const resolvedText = rawStatus
          .replace('{servers}', `${guildCount} ${serverWord}`)
          .replace('{serverCount}', guildCount)
          .replace('{prefix}', config.bot.prefix || '?')
          .replace('{name}', config.bot.name || 'ABYSS');

        client.user.setPresence({
          status: config.bot.presence || 'online',
          activities: [
            {
              name: resolvedText,
              state: resolvedText,
              type: chosenType
            }
          ]
        });
        logger.system(`Default presence engaged: [${config.bot.presence}] ${resolvedText}`);
      } catch (err) {
        logger.error(`Presence synchronization error: ${err.message}`);
      }

      // Sync bot avatar to official ABYSS logo
      try {
        const path = require('path');
        const fs = require('fs');
        const logoPath = path.join(__dirname, '../assets/logo.png');
        if (fs.existsSync(logoPath)) {
          client.user.setAvatar(logoPath).then(() => {
            logger.system('Bot profile avatar synchronized with official ABYSS logo.');
          }).catch(err => {
            logger.system(`Avatar sync notice: ${err.message}`);
          });
        }
      } catch (err) {}

      // Auto-sync Discord bot application description ("About Me")
      try {
        if (config.bot.description) {
          client.application.fetch().then(app => {
            app.edit({ description: config.bot.description }).then(() => {
              logger.system('Bot profile "About Me" description synchronized with Discord API.');
            }).catch(e => {
              logger.system(`Description sync notice: ${e.message}`);
            });
          }).catch(() => {});
        }
      } catch (err) {}
    });

    // Message Event (Commands & Modmail)
    client.on('messageCreate', async message => {
      if (message.author.bot) return;

      // Handle Direct Messages (Modmail support)
      if (!message.guild) {
        return handleDirectMessage(client, message);
      }

      // Handle Staff Reply shortcut in Modmail channels (?r or ?reply)
      const prefix = config.bot.prefix || '?';
      if (message.content.startsWith(`${prefix}reply `) || message.content.startsWith(`${prefix}r `)) {
        const text = message.content.replace(/^(\?reply|\?r)\s+/, '');
        const handled = await handleStaffReply(message, text);
        if (handled) return;
      }

      // Handle Prefix Commands (?help, ?ping, ?ticketpanel, ?ban, etc.)
      await handleCommand(message, prefix);
    });

    // Interaction Event (Ticket Support Buttons)
    client.on('interactionCreate', async interaction => {
      if (interaction.isButton()) {
        await handleTicketButton(interaction);
      }
    });

    // Voice State Update Event (Dynamic Temporary Voice Channels)
    client.on('voiceStateUpdate', async (oldState, newState) => {
      await handleVoiceStateUpdate(oldState, newState);
    });

    // Channel Delete Event (Cleanup tickets and modmail sessions if deleted in Discord)
    client.on('channelDelete', channel => {
      handleChannelDelete(channel);
      handleModmailChannelDelete(channel);
    });

    // Error logging
    client.on('error', err => {
      logger.error(`Discord client error: ${err.message}`);
    });
  }

  async connectDiscord() {
    let token = (process.env.DISCORD_TOKEN || '').trim().replace(/^["']|["']$/g, '');

    if (!token || token === 'YOUR_DISCORD_BOT_TOKEN_HERE') {
      logger.warn('----------------------------------------------------------------------');
      logger.warn('⚠️  DISCORD_TOKEN is not yet set in .env.');
      logger.warn('    The Cyber-Deck Web Console is ONLINE at http://localhost:' + (process.env.PORT || 3000));
      logger.warn('    You can enter your token in the "CREDENTIALS VAULT" tab of the web console');
      logger.warn('    or paste it into the .env file to link the bot to Discord.');
      logger.warn('----------------------------------------------------------------------');
      return;
    }

    try {
      logger.discord('Connecting to Discord Quantum Gateway...');
      await this.client.login(token);
    } catch (err) {
      logger.error(`Failed to authenticate with Discord Gateway: ${err.message}`);
      logger.warn('Please check your token in .env or the web console and ensure Privileged Gateway Intents are enabled.');
    }
  }

  async restartBot() {
    logger.system('Engaging engine reboot cycle...');
    try {
      if (this.client) {
        await this.client.destroy();
      }
      this.client = this.createClient();
      this.setupEventHandlers();
      // Reload .env
      delete require.cache[require.resolve('dotenv')];
      require('dotenv').config({ override: true });
      await this.connectDiscord();
      logger.system('Reboot cycle completed successfully.');
    } catch (err) {
      logger.error(`Reboot error: ${err.message}`);
    }
  }
}

const manager = new BotManager();
manager.init();

module.exports = manager;

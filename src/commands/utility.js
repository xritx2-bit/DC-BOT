const { EmbedBuilder, ActivityType, PermissionsBitField, version: djsVersion } = require('discord.js');
const os = require('os');
const config = require('../../config.json');
const { PRIMARY_COLOR, ACCENT_COLOR, successEmbed, errorEmbed, infoEmbed } = require('../utils/embeds');
const { getActiveTickets } = require('../handlers/ticketHandler');
const { getActiveSessions } = require('../handlers/modmailHandler');

function formatUptime(seconds) {
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${d}d ${h}h ${m}m ${s}s`;
}

module.exports = {
  name: 'utility',
  description: 'Futuristic telemetry & server utility commands',
  execute: async (message, args, cmdName) => {
    const client = message.client;
    const botName = config.bot.name || 'NEXUS ENGINE';
    const tagline = config.bot.tagline || 'Next-Gen Autonomous Support & Server Operations';

    // PING
    if (cmdName === 'ping') {
      const sent = await message.reply('⚡ *Scanning transmission relay...*');
      const latency = sent.createdTimestamp - message.createdTimestamp;
      const wsPing = client.ws.ping;

      const embed = new EmbedBuilder()
        .setColor(PRIMARY_COLOR)
        .setTitle(`⚡ ${botName} // TELEMETRY PING`)
        .addFields(
          { name: '📡 Message Relay', value: `\`${latency} ms\``, inline: true },
          { name: '🌐 Gateway Heartbeat', value: `\`${wsPing >= 0 ? wsPing : 0} ms\``, inline: true },
          { name: '⏱️ Process Uptime', value: `\`${formatUptime(process.uptime())}\``, inline: true }
        )
        .setFooter({ text: 'Quantum Transmission Online' })
        .setTimestamp();

      return sent.edit({ content: null, embeds: [embed] });
    }

    // BOTINFO
    if (cmdName === 'botinfo') {
      const memory = process.memoryUsage();
      const ramMb = (memory.heapUsed / 1024 / 1024).toFixed(2);
      const totalMemMb = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);
      const openTickets = getActiveTickets().length;
      const openDms = getActiveSessions().length;

      const logo = config.bot.logoUrl || client.user.displayAvatarURL();

      const embed = new EmbedBuilder()
        .setColor(PRIMARY_COLOR)
        .setTitle(`⚡ ${botName} // CORE TELEMETRY`)
        .setThumbnail(logo)
        .setDescription(
          `**"${tagline}"**\n\n` +
          `High-performance support and utility engine running on Node.js ${process.version} and Discord.js v${djsVersion}.`
        )
        .addFields(
          { name: '🤖 Bot Tag', value: `\`${client.user.tag}\``, inline: true },
          { name: '🆔 Bot ID', value: `\`${client.user.id}\``, inline: true },
          { name: '🛡️ Guilds In Grid', value: `\`${client.guilds.cache.size}\``, inline: true },
          { name: '👥 Total Users', value: `\`${client.users.cache.size}\``, inline: true },
          { name: '🎫 Active Tickets', value: `\`${openTickets}\``, inline: true },
          { name: '📩 Active Modmail', value: `\`${openDms}\``, inline: true },
          { name: '💾 Memory Allocation', value: `\`${ramMb} MB\``, inline: true },
          { name: '💻 System Host', value: `\`${os.type()} (${os.arch()})\``, inline: true },
          { name: '⏱️ Engine Uptime', value: `\`${formatUptime(process.uptime())}\``, inline: true }
        )
        .setFooter({ text: `Console Port: ${config.console.port || 3000}`, iconURL: logo })
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    }

    // SERVERINFO
    if (cmdName === 'serverinfo') {
      const g = message.guild;
      const owner = await g.fetchOwner().catch(() => null);

      const embed = new EmbedBuilder()
        .setColor(PRIMARY_COLOR)
        .setTitle(`🌐 ${g.name.toUpperCase()} // SECTOR DATA`)
        .setThumbnail(g.iconURL({ dynamic: true }))
        .addFields(
          { name: '👑 Sector Owner', value: owner ? `<@${owner.id}> (${owner.user.tag})` : 'Unknown', inline: true },
          { name: '🆔 Sector ID', value: `\`${g.id}\``, inline: true },
          { name: '📅 Commissioned On', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:D>`, inline: true },
          { name: '👥 Member Count', value: `\`${g.memberCount} members\``, inline: true },
          { name: '💬 Text Channels', value: `\`${g.channels.cache.filter(c => c.type === 0).size}\``, inline: true },
          { name: '🔊 Voice Channels', value: `\`${g.channels.cache.filter(c => c.type === 2).size}\``, inline: true },
          { name: '🛡️ Roles Count', value: `\`${g.roles.cache.size}\``, inline: true },
          { name: '🚀 Boost Tier', value: `Level ${g.premiumTier} (${g.premiumSubscriptionCount || 0} boosts)`, inline: true }
        )
        .setImage(g.bannerURL({ size: 1024 }) || null)
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    }

    // USERINFO
    if (cmdName === 'userinfo') {
      const target = message.mentions.members.first() || message.guild.members.cache.get(args[0]) || message.member;
      const u = target.user;

      const roles = target.roles.cache
        .filter(r => r.id !== message.guild.id)
        .map(r => `<@&${r.id}>`)
        .join(' ') || '*No special roles*';

      const embed = new EmbedBuilder()
        .setColor(PRIMARY_COLOR)
        .setTitle(`👤 IDENTIFICATION PROFILE // ${u.tag}`)
        .setThumbnail(u.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: '🆔 Subject ID', value: `\`${u.id}\``, inline: true },
          { name: '🏷️ Nickname', value: `\`${target.nickname || 'None'}\``, inline: true },
          { name: '🤖 Bot Account', value: `\`${u.bot ? 'Yes' : 'No'}\``, inline: true },
          { name: '📅 Account Created', value: `<t:${Math.floor(u.createdTimestamp / 1000)}:R>`, inline: true },
          { name: '📥 Joined Server', value: `<t:${Math.floor(target.joinedTimestamp / 1000)}:R>`, inline: true },
          { name: '⚡ Roles [Total: ' + target.roles.cache.size + ']', value: roles.slice(0, 1024) }
        )
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    }

    // SAY / BROADCAST
    if (cmdName === 'say' || cmdName === 'announce') {
      const text = args.join(' ');
      if (!text) {
        return message.reply({ content: 'Provide an announcement text message.' });
      }

      if (message.deletable) {
        await message.delete().catch(() => {});
      }

      const embed = new EmbedBuilder()
        .setColor(PRIMARY_COLOR)
        .setTitle(`⚡ ${botName} // SECTOR BROADCAST`)
        .setDescription(text)
        .setFooter({ text: `Broadcast authorized by ${message.author.tag}` })
        .setTimestamp();

      return message.channel.send({ embeds: [embed] });
    }

    // SETSTATUS (Format: ?setstatus ?help — abyss.gg — 75,284 servers)
    if (cmdName === 'setstatus') {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator) &&
          !message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return message.reply({ embeds: [errorEmbed('Access Denied', 'You require Administrator or Manage Server permissions to modify bot presence.')] });
      }

      const newStatus = args.join(' ');
      if (!newStatus) {
        return message.reply({
          embeds: [errorEmbed('Syntax Error', `Usage: \`${config.bot.prefix}setstatus <status text>\`\nExample: \`${config.bot.prefix}setstatus ?help — abyss.gg — 75,284 servers\``)]
        });
      }

      client.user.setPresence({
        status: 'online',
        activities: [
          {
            name: newStatus,
            state: newStatus,
            type: ActivityType.Custom
          }
        ]
      });

      return message.reply({
        embeds: [successEmbed('Presence Synchronized', `Bot custom status updated to:\n**\`${newStatus}\`**`)]
      });
    }

    // SETDESC (Updates Discord bot profile About Me description)
    if (cmdName === 'setdesc' || cmdName === 'setdescription') {
      if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator) &&
          !message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return message.reply({ embeds: [errorEmbed('Access Denied', 'You require Administrator or Manage Server permissions to modify bot profile description.')] });
      }

      const newDesc = args.join(' ');
      if (!newDesc) {
        return message.reply({
          embeds: [errorEmbed('Syntax Error', `Usage: \`${config.bot.prefix}setdesc <description>\``)]
        });
      }

      try {
        await client.application.fetch();
        await client.application.edit({ description: newDesc });

        return message.reply({
          embeds: [successEmbed('Application Description Synchronized', `Bot profile "About Me" updated on Discord:\n\`\`\`\n${newDesc}\n\`\`\``)]
        });
      } catch (err) {
        return message.reply({
          embeds: [errorEmbed('Update Failed', `Could not update Discord description: ${err.message}`)]
        });
      }
    }
  }
};

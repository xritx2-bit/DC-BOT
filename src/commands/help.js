const { EmbedBuilder } = require('discord.js');
const config = require('../../config.json');
const { PRIMARY_COLOR, ACCENT_COLOR } = require('../utils/embeds');

module.exports = {
  name: 'help',
  description: 'Displays the futuristic command manual',
  execute: async (message, args) => {
    const p = config.bot.prefix || '?';
    const botName = config.bot.name || 'NEXUS ENGINE';
    const tagline = config.bot.tagline || 'Next-Gen Autonomous Support & Server Operations';

    const embed = new EmbedBuilder()
      .setColor(PRIMARY_COLOR)
      .setTitle(`⚡ ${botName} // COMMAND MANUAL`)
      .setDescription(
        `**"${tagline}"**\n\n` +
        `**${botName}** is your server's dedicated support, utility, and management engine. Below are the operational directives and command protocols available on this grid.`
      )
      .addFields(
        {
          name: '🎫 TICKET SUPPORT PROTOCOLS',
          value:
            `\`${p}ticketpanel\` • Deploy the interactive Support Dispatch panel with buttons\n` +
            `\`${p}close\` • Terminate the current ticket session & archive transcript\n` +
            `\`${p}transcript\` • Export a full HTML/Text log of the ticket conversation`
        },
        {
          name: '📩 DM SUPPORT & MODMAIL',
          value:
            `• Direct Message the bot to initiate private communication with staff\n` +
            `\`${p}reply <message>\` (or \`${p}r\`) • Staff reply to relay messages back to user DMs\n` +
            `• Web Console has real-time Modmail transmission interface`
        },
        {
          name: '🔊 VOICE & TEMP VC MANAGEMENT',
          value:
            `\`${p}vchub\` • Automatically deploy the "➕ Join to Create" dynamic VC hub\n` +
            `\`${p}vclock\` • Lock your temporary voice channel to prevent other members from joining\n` +
            `\`${p}vcunlock\` • Unlock your temporary voice room\n` +
            `\`${p}vclimit <1-99>\` • Adjust member limit for your dynamic voice room`
        },
        {
          name: '🛡️ SERVER MODERATION DIRECTIVES',
          value:
            `\`${p}kick @user [reason]\` • Evict a user from the server\n` +
            `\`${p}ban @user [reason]\` • Permanently exile a member\n` +
            `\`${p}timeout @user <mins> [reason]\` • Temporarily mute a disruptive user\n` +
            `\`${p}warn @user [reason]\` • Issue a formal infraction warning\n` +
            `\`${p}clear <1-100>\` • Purge message history\n` +
            `\`${p}lock\` / \`${p}unlock\` • Freeze or unfreeze channel send permissions`
        },
        {
          name: '💠 TELEMETRY & UTILITY',
          value:
            `\`${p}ping\` • Measure network latency and WebSocket heartbeat\n` +
            `\`${p}botinfo\` • View bot system metrics, uptime & memory telemetry\n` +
            `\`${p}serverinfo\` • Server overview and statistics\n` +
            `\`${p}userinfo [@user]\` • Inspect user credentials, roles, and status\n` +
            `\`${p}say <message>\` • Broadcast an official embed announcement`
        }
      )
      .setFooter({
        text: `Prefix: ${p} • Access the Cyber-Deck Web Console at port ${config.console.port || 3000}`
      })
      .setTimestamp();

    await message.reply({ embeds: [embed] });
  }
};

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../../config.json');
const { PRIMARY_COLOR } = require('../utils/embeds');

module.exports = {
  name: 'invite',
  description: 'Generates the official 1-click invite link to add ABYSS ENGINE to any Discord server',
  execute: async (message, args) => {
    const clientId = process.env.CLIENT_ID || message.client.user.id;
    const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=8&scope=bot%20applications.commands`;
    const logo = config.bot.logoUrl || message.client.user.displayAvatarURL();

    const embed = new EmbedBuilder()
      .setColor(PRIMARY_COLOR)
      .setTitle(`⚡ ${config.bot.name || 'ABYSS ENGINE'} // MULTI-SERVER AUTHORIZATION LINK`)
      .setThumbnail(logo)
      .setDescription(
        `**Add ${config.bot.name || 'ABYSS ENGINE'} to any server across the grid with zero extra setup.**\n\n` +
        `Click the button below or use the direct link to authorize the engine for your Discord community.\n\n` +
        `**What you get instantly upon authorization:**\n` +
        `• 🎫 **Encrypted Ticket System** (\`?ticketpanel\`)\n` +
        `• 📩 **Direct Modmail & DM Support Bridge**\n` +
        `• 🔊 **Dynamic "Join-to-Create" Voice Lounges** (\`?vchub\`)\n` +
        `• 🛡️ **Autonomous Server Moderation & Security Suite**\n` +
        `• 💻 **Cyber-Deck Web Console Telemetry & Controls**\n\n` +
        `🔗 **Custom 1-Click Invite Link:**\n` +
        `https://dc-bot-production-5855.up.railway.app/invite\n\n` +
        `*(Or click the button below to authorize immediately)*`
      )
      .setFooter({ text: 'Requires Manage Server or Administrator permission to add bots.' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('➕ Authorize & Add to Server')
        .setStyle(ButtonStyle.Link)
        .setURL(inviteUrl)
    );

    return message.reply({ embeds: [embed], components: [row] });
  }
};

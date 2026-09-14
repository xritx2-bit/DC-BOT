const { EmbedBuilder } = require('discord.js');
const config = require('../../config.json');

function hexToColor(hex) {
  return parseInt(hex.replace('#', ''), 16);
}

const PRIMARY_COLOR = hexToColor(config.bot.themeColor || '#FF1E27');
const ACCENT_COLOR = hexToColor(config.bot.accentColor || '#00F3FF');
const SUCCESS_COLOR = 0x00FF88;
const ERROR_COLOR = 0xFF2D55;
const WARN_COLOR = 0xFFB800;

function baseEmbed() {
  return new EmbedBuilder()
    .setColor(PRIMARY_COLOR)
    .setFooter({
      text: `${config.bot.name} • Futuristic Server Protocol`,
      iconURL: 'https://cdn.discordapp.com/emojis/1049382903932825640.webp?size=96&quality=lossless'
    })
    .setTimestamp();
}

function successEmbed(title, description) {
  return baseEmbed()
    .setColor(SUCCESS_COLOR)
    .setTitle(`⚡ ${title}`)
    .setDescription(description);
}

function errorEmbed(title, description) {
  return baseEmbed()
    .setColor(ERROR_COLOR)
    .setTitle(`⚠️ ${title}`)
    .setDescription(description);
}

function infoEmbed(title, description) {
  return baseEmbed()
    .setColor(ACCENT_COLOR)
    .setTitle(`💠 ${title}`)
    .setDescription(description);
}

function ticketPanelEmbed() {
  const botName = config.bot.name || 'SUPPORT ENGINE';
  const tagline = config.bot.tagline || 'Next-Gen Autonomous Support & Server Operations';

  return new EmbedBuilder()
    .setColor(PRIMARY_COLOR)
    .setTitle(`⚡ ${botName} // SUPPORT & DISPATCH NEXUS`)
    .setDescription(
      `**"${tagline}"**\n\n` +
      `Welcome to the **Community Support Hub**. Our automated engine routes your request directly to server operators and support officers.\n\n` +
      `**Available Protocols:**\n` +
      `• 🎫 **General Support**: Inquiries, verification, server queries.\n` +
      `• ⚡ **Technical / Bot**: Command troubleshooting or bot assistance.\n` +
      `• 🛡️ **Report / Incident**: Report user harassment, exploits, or rule violations.\n\n` +
      `*Click the corresponding button below to initiate an encrypted ticket session.*`
    )
    .setImage('https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&w=1200&q=80')
    .setFooter({ text: `${botName} • Ticket Protocol v2.6` })
    .setTimestamp();
}

function ticketWelcomeEmbed(user, categoryLabel) {
  const botName = config.bot.name || 'SUPPORT ENGINE';

  return new EmbedBuilder()
    .setColor(PRIMARY_COLOR)
    .setTitle(`🎫 SUPPORT SESSION INITIALIZED // ${categoryLabel.toUpperCase()}`)
    .setDescription(
      `Greetings, <@${user.id}>.\n\n` +
      `Your private encrypted support channel is now active. Server staff has been alerted.\n\n` +
      `**Instructions:**\n` +
      `• Describe your issue in detail.\n` +
      `• Attach screenshots or IDs if relevant.\n` +
      `• Use the control buttons below to manage this session.`
    )
    .addFields(
      { name: '👤 Initiated By', value: `<@${user.id}> (${user.tag || user.username})`, inline: true },
      { name: '📂 Protocol Category', value: categoryLabel, inline: true },
      { name: '🔒 Security Level', value: 'Private Staff Encrypted', inline: true }
    )
    .setFooter({ text: `${botName} • Click Close below to finalize this ticket.` })
    .setTimestamp();
}

module.exports = {
  PRIMARY_COLOR,
  ACCENT_COLOR,
  SUCCESS_COLOR,
  ERROR_COLOR,
  WARN_COLOR,
  baseEmbed,
  successEmbed,
  errorEmbed,
  infoEmbed,
  ticketPanelEmbed,
  ticketWelcomeEmbed
};

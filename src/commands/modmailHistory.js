const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const config = require('../../config.json');
const { PRIMARY_COLOR, ACCENT_COLOR, infoEmbed, errorEmbed } = require('../utils/embeds');
const {
  getActiveSessionsDetailed,
  getArchivedSessions,
  getSessionConversation,
  generateModmailTranscriptAttachment
} = require('../handlers/modmailHandler');

function isStaffMember(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionsBitField.Flags.Administrator) ||
      member.permissions.has(PermissionsBitField.Flags.ManageGuild) ||
      member.permissions.has(PermissionsBitField.Flags.ManageChannels) ||
      member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
    return true;
  }
  const configuredRoles = [
    ...(config.roles?.adminRoles || []),
    ...(config.roles?.staffRoles || []),
    ...(config.modmail?.mentionRoles || [])
  ].map(r => r.toString().toLowerCase());

  return member.roles.cache.some(r =>
    configuredRoles.some(c => c === r.id || r.name.toLowerCase() === c || r.name.toLowerCase().includes(c))
  );
}

module.exports = {
  name: 'modmailhistory',
  description: 'View active and archived modmail sessions, originating servers, and conversation transcripts',
  execute: async (message, args, cmdName) => {
    // Check permissions
    if (!isStaffMember(message.member)) {
      return message.reply({
        embeds: [errorEmbed('Access Denied', 'You require staff authorization to inspect modmail session archives.')]
      });
    }

    const targetId = args[0] ? args[0].replace(/[<@!>]/g, '') : null;

    // View specific session conversation / transcript
    if (targetId) {
      const session = getSessionConversation(targetId);
      if (!session) {
        return message.reply({
          embeds: [errorEmbed('Session Not Found', `No active or archived modmail session found matching \`${targetId}\`.`)]
        });
      }

      const transcriptFile = generateModmailTranscriptAttachment(session);
      const msgs = session.messages || [];

      let previewText = '';
      const recentMsgs = msgs.slice(-8); // Show up to last 8 messages in embed preview
      for (const m of recentMsgs) {
        const time = m.timestamp ? `<t:${Math.floor(new Date(m.timestamp).getTime() / 1000)}:R>` : '';
        const tag = m.isStaff ? `🛡️ **${m.authorName} (Staff)**` : `👤 **${m.authorName} (User)**`;
        const contentSnippet = m.content ? m.content.slice(0, 150) : '*[Attachment/No text]*';
        previewText += `${tag} ${time}:\n${contentSnippet}\n\n`;
      }

      const sessionGuild = message.client.guilds.cache.get(session.guildId);
      const sessionGuildIcon = sessionGuild?.iconURL ? sessionGuild.iconURL({ dynamic: true }) : null;

      const detailEmbed = new EmbedBuilder()
        .setColor(PRIMARY_COLOR)
        .setTitle(`📩 MODMAIL CONVERSATION // @${session.username}`)
        .setThumbnail(sessionGuildIcon || null)
        .setDescription(
          `**Originating Server:** **${session.guildName || 'Unknown Server'}** (${session.guildId || 'N/A'})\n` +
          `**Target User:** <@${session.userId}> (\`${session.userId}\`)\n` +
          `**Channel:** #${session.channelName || session.channelId || 'dm-channel'}\n` +
          `**Status:** \`${(session.status || 'active').toUpperCase()}\`\n` +
          `**Started:** <t:${Math.floor(new Date(session.startedAt).getTime() / 1000)}:f>\n` +
          (session.closedAt ? `**Closed:** <t:${Math.floor(new Date(session.closedAt).getTime() / 1000)}:f> by **${session.closedBy}**\n` : '') +
          `**Total Messages Exchanged:** \`${msgs.length}\`\n\n` +
          `**Recent Conversation Stream:**\n` +
          (previewText || '*No messages recorded yet.*')
        )
        .setFooter({ text: `${config.bot.name} • Complete conversation file attached below.` })
        .setTimestamp();

      return message.reply({
        embeds: [detailEmbed],
        files: [transcriptFile]
      });
    }

    // List all active and recent archived sessions
    const active = getActiveSessionsDetailed(message.client);
    const archived = getArchivedSessions(10);
    const prefix = config.bot.prefix || '?';

    let activeText = '';
    if (active.length === 0) {
      activeText = '*No modmail sessions currently active.*';
    } else {
      activeText = active.map((s, idx) => {
        return `**${idx + 1}.** 👤 <@${s.userId}> (\`${s.username}\`)\n` +
               `   • 🌐 **Server:** **${s.guildName}**\n` +
               `   • 💬 **Messages:** \`${s.messagesCount}\` | ⏱️ <t:${Math.floor(new Date(s.startedAt).getTime() / 1000)}:R>\n` +
               `   • 📂 **Channel:** <#${s.channelId}>`;
      }).join('\n\n');
    }

    let archivedText = '';
    if (archived.length === 0) {
      archivedText = '*No archived sessions on record.*';
    } else {
      archivedText = archived.map((s, idx) => {
        return `**${idx + 1}.** 👤 @${s.username} (\`${s.userId}\`)\n` +
               `   • 🌐 **Server:** **${s.guildName}**\n` +
               `   • 💬 **Messages:** \`${s.messagesCount}\` | 🔒 Closed by **${s.closedBy || 'Staff'}**\n` +
               `   • ⏱️ <t:${Math.floor(new Date(s.startedAt).getTime() / 1000)}:d>`;
      }).join('\n\n');
    }

    const listEmbed = new EmbedBuilder()
      .setColor(PRIMARY_COLOR)
      .setTitle(`⚡ ${config.bot.name} // MODMAIL HUB & ARCHIVE`)
      .setDescription(
        `Review which servers modmail sessions originate from and inspect live/past conversation transcripts.\n\n` +
        `💡 *Type \`${prefix}modmailhistory <userId>\` to view complete chat history and download transcript.*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
      )
      .addFields(
        { name: `🟢 ACTIVE SESSIONS (${active.length})`, value: activeText },
        { name: `📁 RECENT ARCHIVE (${archived.length})`, value: archivedText }
      )
      .setFooter({ text: `${config.bot.name} • Cyber-Deck Modmail Protocol` })
      .setTimestamp();

    return message.reply({ embeds: [listEmbed] });
  }
};

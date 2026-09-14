const {
  ChannelType,
  PermissionsBitField,
  EmbedBuilder
} = require('discord.js');
const config = require('../../config.json');
const logger = require('../utils/logger');
const { PRIMARY_COLOR, ACCENT_COLOR, successEmbed, infoEmbed } = require('../utils/embeds');

// Active DM sessions: userId -> { channelId, username, startedAt }
const activeSessions = new Map();
// Reverse lookup: channelId -> userId
const channelToUser = new Map();

async function handleDirectMessage(client, message) {
  if (message.author.bot) return;
  if (!config.modmail || !config.modmail.enabled) return;

  const user = message.author;
  const content = message.content;
  const attachments = Array.from(message.attachments.values()).map(a => a.url);

  // Find target guild (first available guild or configured guild)
  const guild = client.guilds.cache.get(process.env.GUILD_ID) || client.guilds.cache.first();
  if (!guild) {
    logger.warn('Modmail received but bot is not in any server yet.');
    return;
  }

  try {
    let session = activeSessions.get(user.id);
    let channel;

    if (session) {
      channel = guild.channels.cache.get(session.channelId);
    }

    if (!channel) {
      // Fetch fresh channels from Discord REST API to eliminate stale deleted channels in cache
      const freshChannels = await guild.channels.fetch().catch(() => guild.channels.cache);
      let category = freshChannels.find(
        c => c && c.type === ChannelType.GuildCategory && c.name.toLowerCase() === config.modmail.categoryName.toLowerCase()
      );

      if (!category) {
        category = await guild.channels.create({
          name: config.modmail.categoryName,
          type: ChannelType.GuildCategory,
          permissionOverwrites: [
            {
              id: guild.roles.everyone.id,
              deny: [PermissionsBitField.Flags.ViewChannel]
            }
          ]
        });
      }

      // Channel permissions
      const permissionOverwrites = [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionsBitField.Flags.ViewChannel]
        },
        {
          id: guild.members.me.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ManageChannels,
            PermissionsBitField.Flags.ReadMessageHistory
          ]
        }
      ];

      const staffRoleNames = config.roles.staffRoles || [];
      guild.roles.cache.forEach(role => {
        if (staffRoleNames.some(name => role.name.toLowerCase() === name.toLowerCase())) {
          permissionOverwrites.push({
            id: role.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ReadMessageHistory
            ]
          });
        }
      });

      const sanitizedUsername = user.username.toLowerCase().replace(/[^a-z0-9]/g, '');
      const channelName = `dm-${sanitizedUsername || 'user'}`;

      try {
        channel = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: category ? category.id : null,
          topic: `Direct Support Session for ${user.tag} (ID: ${user.id})`,
          permissionOverwrites
        });
      } catch (err) {
        logger.warn(`Initial modmail channel creation with parent failed: ${err.message}. Retrying...`);
        try {
          category = await guild.channels.create({
            name: config.modmail.categoryName,
            type: ChannelType.GuildCategory
          });
          channel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: category.id,
            topic: `Direct Support Session for ${user.tag} (ID: ${user.id})`,
            permissionOverwrites
          });
        } catch (retryErr) {
          logger.warn(`Modmail category creation failed (${retryErr.message}). Creating standalone modmail channel.`);
          channel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            topic: `Direct Support Session for ${user.tag} (ID: ${user.id})`,
            permissionOverwrites
          });
        }
      }

      activeSessions.set(user.id, {
        channelId: channel.id,
        userId: user.id,
        username: user.tag || user.username,
        startedAt: new Date().toISOString()
      });
      channelToUser.set(channel.id, user.id);

      logger.modmail(`Opened direct support thread #${channel.name} for @${user.tag}`);

      // Initial notice in staff channel
      const initEmbed = new EmbedBuilder()
        .setColor(PRIMARY_COLOR)
        .setTitle(`📩 NEW DM SUPPORT SESSION // @${user.tag}`)
        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
        .setDescription(
          `**User:** <@${user.id}> (${user.id})\n` +
          `**Account Created:** <t:${Math.floor(user.createdTimestamp / 1000)}:R>\n\n` +
          `*To reply to this user, type:*\n` +
          `\`?reply <your message>\` or simply use the Web Cyber-Deck Console.`
        )
        .setTimestamp();

      await channel.send({ embeds: [initEmbed] });

      // Notify the user in DM
      await message.reply({
        embeds: [
          infoEmbed(
            'Support Session Connected',
            'Your direct message has been securely transmitted to our staff team. An operator will reply directly to this DM shortly.'
          )
        ]
      });
    }

    // Forward the message to the staff channel
    const msgEmbed = new EmbedBuilder()
      .setColor(ACCENT_COLOR)
      .setAuthor({ name: `${user.tag} (User DM)`, iconURL: user.displayAvatarURL({ dynamic: true }) })
      .setDescription(content || '*[No text content]*')
      .setTimestamp();

    if (attachments.length > 0) {
      msgEmbed.addFields({ name: '📎 Attachments', value: attachments.join('\n') });
    }

    await channel.send({ embeds: [msgEmbed] });
    logger.modmail(`Forwarded DM from @${user.tag} to #${channel.name}`);
  } catch (err) {
    logger.error(`Modmail DM processing failed: ${err.message}`, err.stack);
  }
}

async function handleStaffReply(message, replyText) {
  const userId = channelToUser.get(message.channel.id);
  if (!userId) return false;

  try {
    const user = await message.client.users.fetch(userId);
    if (!user) {
      await message.reply('❌ Could not resolve target user.');
      return true;
    }

    const botName = config.bot.name || 'SUPPORT ENGINE';
    const replyEmbed = new EmbedBuilder()
      .setColor(PRIMARY_COLOR)
      .setAuthor({
        name: `${botName} Support (${message.author.tag})`,
        iconURL: message.guild.iconURL({ dynamic: true }) || message.author.displayAvatarURL()
      })
      .setDescription(replyText)
      .setFooter({ text: `${config.bot.name} • Reply to this DM to continue conversation.` })
      .setTimestamp();

    await user.send({ embeds: [replyEmbed] });

    await message.react('✅');
    logger.modmail(`Staff @${message.author.tag} replied to @${user.tag} in #${message.channel.name}`);
    return true;
  } catch (err) {
    logger.error(`Failed to send staff reply to user: ${err.message}`);
    await message.reply(`❌ Failed to send DM to user: ${err.message}`);
    return true;
  }
}

async function sendDirectReplyFromConsole(client, userId, messageText, staffName = 'Admin Console') {
  const user = await client.users.fetch(userId);
  if (!user) throw new Error('User not found');

  const botName = config.bot.name || 'SUPPORT ENGINE';
  const replyEmbed = new EmbedBuilder()
    .setColor(PRIMARY_COLOR)
    .setAuthor({ name: `${botName} Support (${staffName})` })
    .setDescription(messageText)
    .setFooter({ text: `${config.bot.name} • Web Console Transmission` })
    .setTimestamp();

  await user.send({ embeds: [replyEmbed] });
  logger.modmail(`Console dispatched DM to @${user.tag}: "${messageText}"`);

  // Log in channel if open
  const session = activeSessions.get(userId);
  if (session) {
    const channel = client.channels.cache.get(session.channelId);
    if (channel) {
      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(PRIMARY_COLOR)
            .setAuthor({ name: `Cyber-Deck Console Dispatch` })
            .setDescription(messageText)
            .setTimestamp()
        ]
      });
    }
  }
  return true;
}

function handleModmailChannelDelete(channel) {
  const userId = channelToUser.get(channel.id);
  if (userId) {
    activeSessions.delete(userId);
    channelToUser.delete(channel.id);
    logger.modmail(`Modmail channel #${channel.name} was removed. Cleaned active session.`);
  }
}

function getActiveSessions(client) {
  if (client && client.channels && client.channels.cache) {
    for (const [userId, session] of activeSessions) {
      if (!client.channels.cache.has(session.channelId)) {
        channelToUser.delete(session.channelId);
        activeSessions.delete(userId);
      }
    }
  }
  return Array.from(activeSessions.values());
}

module.exports = {
  handleDirectMessage,
  handleStaffReply,
  sendDirectReplyFromConsole,
  getActiveSessions,
  handleModmailChannelDelete,
  channelToUser
};

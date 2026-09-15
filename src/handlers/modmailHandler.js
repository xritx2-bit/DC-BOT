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

  // Find target guild:
  let guild = null;
  let session = activeSessions.get(user.id);
  if (session && session.guildId) {
    guild = client.guilds.cache.get(session.guildId) || await client.guilds.fetch(session.guildId).catch(() => null);
  }

  // Check configured target guild / server ID first
  const targetId = config.modmail?.guildId || config.guildId || process.env.GUILD_ID;
  if (!guild && targetId) {
    guild = client.guilds.cache.get(targetId) || await client.guilds.fetch(targetId).catch(() => null);
    if (!guild) {
      // In case targetId was passed as a channel or category ID in the server
      const ch = client.channels.cache.get(targetId) || await client.channels.fetch(targetId).catch(() => null);
      if (ch && ch.guild) {
        guild = ch.guild;
      }
    }
  }

  // Fallback: Check mutual servers if no target was configured
  if (!guild) {
    for (const [id, g] of client.guilds.cache) {
      const isMember = await g.members.fetch(user.id).catch(() => null);
      if (isMember) {
        guild = g;
        break;
      }
    }
  }

  // Ultimate fallback to first cached guild
  if (!guild) {
    guild = client.guilds.cache.first();
  }

  if (!guild) {
    logger.warn('Modmail received but bot is not in any server yet.');
    return;
  }

  try {
    let channel;

    if (session) {
      channel = guild.channels.cache.get(session.channelId) || await guild.channels.fetch(session.channelId).catch(() => null);
    }

    // Fetch fresh channels from Discord REST API to eliminate stale deleted channels in cache
    const freshChannels = await guild.channels.fetch().catch(() => guild.channels.cache);
    const categoryName = config.modmail?.categoryName || 'DIRECT SUPPORT / MODMAIL';
    let category = freshChannels.find(
      c => c && c.type === ChannelType.GuildCategory && c.name.toLowerCase() === categoryName.toLowerCase()
    );

    const sanitizedUsername = user.username.toLowerCase().replace(/[^a-z0-9]/g, '');
    const channelName = `dm-${sanitizedUsername || 'user'}`;

    // If channel wasn't in activeSessions (e.g. after bot restart), reconnect to existing channel if it exists
    if (!channel && category) {
      channel = freshChannels.find(
        c => c && c.parentId === category.id && c.name.toLowerCase() === channelName
      );
      if (channel) {
        activeSessions.set(user.id, {
          channelId: channel.id,
          userId: user.id,
          username: user.tag || user.username,
          guildId: guild.id,
          startedAt: new Date().toISOString()
        });
        channelToUser.set(channel.id, user.id);
      }
    }

    if (!channel) {
      if (!category) {
        category = await guild.channels.create({
          name: categoryName,
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
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.AttachFiles,
            PermissionsBitField.Flags.EmbedLinks
          ]
        }
      ];

      // Build target list of configured higher / staff roles
      const configuredTargetRoles = [
        ...(config.modmail?.mentionRoles || []),
        ...(config.roles?.adminRoles || []),
        ...(config.roles?.staffRoles || [])
      ].map(r => r.toString().toLowerCase());

      const higherRolesToMention = [];
      const guildRoles = await guild.roles.fetch().catch(() => guild.roles.cache);

      guildRoles.forEach(role => {
        if (role.id === guild.roles.everyone.id) return;
        if (role.managed) return; // Skip bot-managed roles

        const roleNameLower = role.name.toLowerCase();
        // Skip obvious bot roles
        if (roleNameLower === 'bots' || roleNameLower.includes('bot access') || roleNameLower.includes('xieron')) return;

        const isConfigured = configuredTargetRoles.some(entry =>
          entry === role.id || roleNameLower === entry || roleNameLower.includes(entry)
        );

        const hasStaffPerms = role.permissions.has(PermissionsBitField.Flags.Administrator) ||
                              role.permissions.has(PermissionsBitField.Flags.ManageGuild) ||
                              role.permissions.has(PermissionsBitField.Flags.ManageChannels) ||
                              role.permissions.has(PermissionsBitField.Flags.ModerateMembers);

        if (isConfigured || hasStaffPerms) {
          if (!permissionOverwrites.some(p => p.id === role.id)) {
            permissionOverwrites.push({
              id: role.id,
              allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory,
                PermissionsBitField.Flags.AttachFiles,
                PermissionsBitField.Flags.EmbedLinks
              ]
            });
          }

          if (!higherRolesToMention.some(r => r.id === role.id)) {
            higherRolesToMention.push(role);
          }
        }
      });

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
            name: categoryName,
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

      // Explicitly enforce overwrites to avoid category inheritance wiping
      await channel.permissionOverwrites.set(permissionOverwrites).catch(() => {});

      activeSessions.set(user.id, {
        channelId: channel.id,
        userId: user.id,
        username: user.tag || user.username,
        guildId: guild.id,
        startedAt: new Date().toISOString()
      });
      channelToUser.set(channel.id, user.id);

      logger.modmail(`Opened direct support thread #${channel.name} in "${guild.name}" (${guild.id}) for @${user.tag}`);

      // Initial notice in staff channel with higher role mentions
      const mentionRoleIds = higherRolesToMention.map(r => r.id);
      const mentionText = mentionRoleIds.length > 0 ? mentionRoleIds.map(id => `<@&${id}>`).join(' ') : '';

      const initEmbed = new EmbedBuilder()
        .setColor(PRIMARY_COLOR)
        .setTitle(`📩 NEW DM SUPPORT SESSION // @${user.tag}`)
        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
        .setDescription(
          `**User:** <@${user.id}> (${user.id})\n` +
          `**Account Created:** <t:${Math.floor(user.createdTimestamp / 1000)}:R>\n\n` +
          `*To reply to this user, type:*\n` +
          `\`?reply <your message>\` or \`?r <your message>\` or simply use the Web Cyber-Deck Console.\n` +
          `*To close this session, type:*\n` +
          `\`?close\` or \`?c\``
        )
        .setTimestamp();

      await channel.send({
        content: mentionText ? `🚨 **NEW DIRECT SUPPORT SESSION** // ${mentionText}` : undefined,
        embeds: [initEmbed],
        allowedMentions: { roles: mentionRoleIds }
      });

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

async function closeModmailSession(channel, closedBy = 'Staff') {
  const userId = channelToUser.get(channel.id);
  if (!userId) return false;

  try {
    const user = await channel.client.users.fetch(userId).catch(() => null);
    if (user) {
      await user.send({
        embeds: [
          infoEmbed(
            'Support Session Closed',
            `Your direct support session with **${channel.guild.name}** has been closed by ${closedBy}. If you require further assistance, simply send another message to start a new session.`
          )
        ]
      }).catch(() => {});
    }

    activeSessions.delete(userId);
    channelToUser.delete(channel.id);

    await channel.send({
      embeds: [infoEmbed('Session Closed', `This direct support session was closed by ${closedBy}. Channel will be removed in 5 seconds.`)]
    }).catch(() => {});

    setTimeout(() => {
      channel.delete('Modmail session closed').catch(() => {});
    }, 5000);

    return true;
  } catch (err) {
    logger.error(`Error closing modmail session: ${err.message}`);
    return false;
  }
}

module.exports = {
  handleDirectMessage,
  handleStaffReply,
  sendDirectReplyFromConsole,
  getActiveSessions,
  handleModmailChannelDelete,
  closeModmailSession,
  channelToUser
};

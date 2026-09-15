const {
  ChannelType,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder
} = require('discord.js');
const config = require('../../config.json');
const logger = require('../utils/logger');
const { PRIMARY_COLOR, ACCENT_COLOR, successEmbed, infoEmbed } = require('../utils/embeds');

// Active DM sessions: userId -> { channelId, username, guildId, startedAt }
const activeSessions = new Map();
// Reverse lookup: channelId -> userId
const channelToUser = new Map();
// Pending server selections for users in multiple servers: userId -> { content, attachments, timestamp }
const pendingModmailSelections = new Map();

async function openModmailSession(client, user, guild, initialContent, initialAttachments, replyToMessage = null) {
  try {
    let session = activeSessions.get(user.id);
    let channel;

    if (session && session.guildId === guild.id) {
      channel = guild.channels.cache.get(session.channelId) || await guild.channels.fetch(session.channelId).catch(() => null);
    }

    // Fetch fresh channels from Discord REST API
    const freshChannels = await guild.channels.fetch().catch(() => guild.channels.cache);
    const categoryName = config.modmail?.categoryName || 'DIRECT SUPPORT / MODMAIL';
    let category = freshChannels.find(
      c => c && c.type === ChannelType.GuildCategory && c.name.toLowerCase() === categoryName.toLowerCase()
    );

    const sanitizedUsername = user.username.toLowerCase().replace(/[^a-z0-9]/g, '');
    const channelName = `dm-${sanitizedUsername || 'user'}`;

    // Reconnect to existing channel if it already exists under category (e.g. after bot restart)
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

      // Base channel permissions
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
          `**Account Created:** <t:${Math.floor(user.createdTimestamp / 1000)}:R>\n` +
          `**Server Context:** **${guild.name}**\n\n` +
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

      // Notify the user in DM if this was triggered directly by a message
      if (replyToMessage) {
        await replyToMessage.reply({
          embeds: [
            infoEmbed(
              'Support Session Connected',
              `Your direct message has been securely transmitted to the staff team of **${guild.name}**. An operator will reply directly to this DM shortly.`
            )
          ]
        }).catch(() => {});
      }
    }

    // Forward the initial user message/attachments to the channel
    const msgEmbed = new EmbedBuilder()
      .setColor(ACCENT_COLOR)
      .setAuthor({ name: `${user.tag} (User DM)`, iconURL: user.displayAvatarURL({ dynamic: true }) })
      .setDescription(initialContent || '*[No text content]*')
      .setTimestamp();

    if (initialAttachments && initialAttachments.length > 0) {
      msgEmbed.addFields({ name: '📎 Attachments', value: initialAttachments.join('\n') });
    }

    await channel.send({ embeds: [msgEmbed] });
    logger.modmail(`Forwarded DM from @${user.tag} to #${channel.name} in "${guild.name}"`);
    return channel;
  } catch (err) {
    logger.error(`Failed to open modmail session in "${guild.name}": ${err.message}`, err.stack);
    return null;
  }
}

async function handleDirectMessage(client, message) {
  if (message.author.bot) return;
  if (!config.modmail || !config.modmail.enabled) return;

  const user = message.author;
  const content = message.content;
  const attachments = Array.from(message.attachments.values()).map(a => a.url);

  // 1. If user already has an active session, route directly to that channel
  let session = activeSessions.get(user.id);
  if (session && session.guildId) {
    const guild = client.guilds.cache.get(session.guildId) || await client.guilds.fetch(session.guildId).catch(() => null);
    if (guild) {
      const channel = guild.channels.cache.get(session.channelId) || await guild.channels.fetch(session.channelId).catch(() => null);
      if (channel) {
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
        return;
      }
    }
  }

  // 2. If user already has a pending server selection in progress:
  if (pendingModmailSelections.has(user.id)) {
    const pending = pendingModmailSelections.get(user.id);
    if (content) {
      pending.content = (pending.content ? pending.content + '\n' : '') + content;
    }
    if (attachments.length > 0) {
      pending.attachments.push(...attachments);
    }
    await message.reply({
      embeds: [infoEmbed('Selection Required', 'Please select a community server from the dropdown menu above to connect your session.')]
    }).catch(() => {});
    return;
  }

  // 3. Scan mutual servers where both the bot and user are present
  const mutualGuilds = [];
  for (const [id, g] of client.guilds.cache) {
    const isMember = await g.members.fetch(user.id).catch(() => null);
    if (isMember) {
      mutualGuilds.push(g);
    }
  }

  // Case A: User is in exactly 1 server with the bot -> Route immediately!
  if (mutualGuilds.length === 1) {
    await openModmailSession(client, user, mutualGuilds[0], content, attachments, message);
    return;
  }

  // Case B: User is in multiple servers (2+) -> Send interactive Select Menu in DM!
  if (mutualGuilds.length > 1) {
    pendingModmailSelections.set(user.id, {
      content: content || '',
      attachments: attachments || [],
      timestamp: Date.now()
    });

    // Auto-expire after 10 minutes
    setTimeout(() => {
      if (pendingModmailSelections.has(user.id)) {
        pendingModmailSelections.delete(user.id);
      }
    }, 10 * 60 * 1000);

    const selectOptions = mutualGuilds.slice(0, 25).map(g => ({
      label: g.name.slice(0, 100),
      description: `Support & Modmail in ${g.name}`.slice(0, 100),
      value: g.id,
      emoji: '🌐'
    }));

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('modmail_guild_select')
        .setPlaceholder('Select the server you need help with...')
        .addOptions(selectOptions)
    );

    const selectEmbed = new EmbedBuilder()
      .setColor(PRIMARY_COLOR)
      .setTitle(`🌐 MULTIPLE SERVERS DETECTED`)
      .setThumbnail(config.bot.logoUrl || null)
      .setDescription(
        `You share **${mutualGuilds.length} servers** with **${config.bot.name}**.\n\n` +
        `Please select which community server you need support from using the menu below:`
      )
      .setFooter({ text: `${config.bot.name} • Direct Support Bridge` })
      .setTimestamp();

    await message.reply({ embeds: [selectEmbed], components: [row] });
    return;
  }

  // Case C: User shares 0 servers with the bot -> Check configured primary guild or notify user
  const primaryId = config.modmail?.guildId || config.guildId || process.env.GUILD_ID;
  let fallbackGuild = null;
  if (primaryId) {
    fallbackGuild = client.guilds.cache.get(primaryId) || await client.guilds.fetch(primaryId).catch(() => null);
  }
  if (!fallbackGuild) {
    fallbackGuild = client.guilds.cache.first();
  }

  if (fallbackGuild) {
    await openModmailSession(client, user, fallbackGuild, content, attachments, message);
  } else {
    await message.reply({
      embeds: [infoEmbed('No Shared Servers', `You do not currently share any Discord servers where ${config.bot.name} is installed.`)]
    }).catch(() => {});
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

async function handleModmailGuildSelect(interaction) {
  if (!interaction.isStringSelectMenu() || interaction.customId !== 'modmail_guild_select') return;

  const selectedGuildId = interaction.values[0];
  const client = interaction.client;
  const user = interaction.user;

  const guild = client.guilds.cache.get(selectedGuildId) || await client.guilds.fetch(selectedGuildId).catch(() => null);
  if (!guild) {
    return interaction.update({
      embeds: [infoEmbed('Server Unavailable', 'The selected server could not be resolved. Please send a new message to try again.')],
      components: []
    });
  }

  const pending = pendingModmailSelections.get(user.id) || { content: '', attachments: [] };
  pendingModmailSelections.delete(user.id);

  // Update DM interaction into confirmation state
  await interaction.update({
    embeds: [
      infoEmbed(
        'Support Session Connected',
        `Your direct message has been securely transmitted to the staff team of **${guild.name}**. An operator will reply directly to this DM shortly.`
      )
    ],
    components: []
  });

  // Open the channel in the selected guild and deliver initial message
  await openModmailSession(client, user, guild, pending.content, pending.attachments, null);
}

module.exports = {
  handleDirectMessage,
  handleStaffReply,
  sendDirectReplyFromConsole,
  getActiveSessions,
  handleModmailChannelDelete,
  closeModmailSession,
  handleModmailGuildSelect,
  channelToUser
};

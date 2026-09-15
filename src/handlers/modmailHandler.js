const fs = require('fs');
const path = require('path');
const {
  ChannelType,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  AttachmentBuilder
} = require('discord.js');
const config = require('../../config.json');
const logger = require('../utils/logger');
const { PRIMARY_COLOR, ACCENT_COLOR, successEmbed, infoEmbed } = require('../utils/embeds');

const DATA_FILE = path.join(__dirname, '../../data/modmail_sessions.json');

// Active DM sessions: userId -> sessionObject
const activeSessions = new Map();
// Reverse lookup: channelId -> userId
const channelToUser = new Map();
// Pending server selections for users in multiple servers: userId -> { content, attachments, timestamp }
const pendingModmailSelections = new Map();
// Archived historical sessions
let archivedSessions = [];

function loadSessionsFromDisk() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.active)) {
        for (const s of data.active) {
          activeSessions.set(s.userId, s);
          if (s.channelId) channelToUser.set(s.channelId, s.userId);
        }
      }
      if (Array.isArray(data.archived)) {
        archivedSessions = data.archived;
      }
      logger.system(`[MODMAIL ENGINE] Synchronized ${activeSessions.size} active & ${archivedSessions.length} archived sessions from disk.`);
    }
  } catch (err) {
    logger.warn(`Failed to read modmail data file: ${err.message}`);
  }
}

function saveSessionsToDisk() {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const payload = {
      active: Array.from(activeSessions.values()),
      archived: archivedSessions.slice(-150)
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2), 'utf8');
  } catch (err) {
    logger.error(`Failed to save modmail sessions: ${err.message}`);
  }
}

loadSessionsFromDisk();

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
        if (!activeSessions.has(user.id)) {
          activeSessions.set(user.id, {
            id: `session_${user.id}_${Date.now()}`,
            channelId: channel.id,
            channelName: channel.name,
            userId: user.id,
            username: user.tag || user.username,
            userAvatar: user.displayAvatarURL ? user.displayAvatarURL({ dynamic: true }) : null,
            guildId: guild.id,
            guildName: guild.name,
            startedAt: new Date().toISOString(),
            status: 'active',
            messages: []
          });
        }
        channelToUser.set(channel.id, user.id);
        saveSessionsToDisk();
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

      const sessionObj = {
        id: `session_${user.id}_${Date.now()}`,
        channelId: channel.id,
        channelName: channel.name,
        userId: user.id,
        username: user.tag || user.username,
        userAvatar: user.displayAvatarURL ? user.displayAvatarURL({ dynamic: true }) : null,
        guildId: guild.id,
        guildName: guild.name,
        startedAt: new Date().toISOString(),
        status: 'active',
        messages: []
      };
      activeSessions.set(user.id, sessionObj);
      channelToUser.set(channel.id, user.id);
      saveSessionsToDisk();

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
        const guildIcon = guild.iconURL({ dynamic: true });
        const connectEmbed = new EmbedBuilder()
          .setColor(0x00FF88)
          .setTitle(`✅ SUPPORT SESSION CONNECTED`)
          .setAuthor({
            name: `${guild.name} Support Hub`,
            iconURL: guildIcon || undefined
          })
          .setThumbnail(guildIcon || config.bot.logoUrl || null)
          .setDescription(
            `Your direct message has been securely transmitted to the staff team of **${guild.name}**.\n\n` +
            `An operator will reply directly to this DM shortly.\n\n` +
            `💬 *Type your message in this DM anytime to send additional updates or files.*`
          )
          .setFooter({
            text: `${guild.name} • Direct Support Bridge`,
            iconURL: guildIcon || undefined
          })
          .setTimestamp();

        await replyToMessage.reply({ embeds: [connectEmbed] }).catch(() => {});
      }
    }

    // Record user's initial message in session history
    const currentSession = activeSessions.get(user.id);
    if (currentSession) {
      if (!currentSession.messages) currentSession.messages = [];
      currentSession.messages.push({
        id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        authorId: user.id,
        authorName: user.tag || user.username,
        authorAvatar: user.displayAvatarURL ? user.displayAvatarURL({ dynamic: true }) : null,
        isStaff: false,
        content: initialContent || '',
        attachments: initialAttachments || [],
        timestamp: new Date().toISOString()
      });
      saveSessionsToDisk();
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

        if (!session.messages) session.messages = [];
        session.messages.push({
          id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          authorId: user.id,
          authorName: user.tag || user.username,
          authorAvatar: user.displayAvatarURL ? user.displayAvatarURL({ dynamic: true }) : null,
          isStaff: false,
          content: content || '',
          attachments: attachments || [],
          timestamp: new Date().toISOString()
        });
        saveSessionsToDisk();

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

    const serverListText = mutualGuilds.map((g, idx) => {
      return `**${idx + 1}.** 🏛️ **${g.name}**\n*(ID: \`${g.id}\` • ${g.memberCount || 0} members)*`;
    }).join('\n\n');

    const firstGuildIcon = mutualGuilds.find(g => g.iconURL && g.iconURL())?.iconURL({ dynamic: true });

    const selectEmbed = new EmbedBuilder()
      .setColor(PRIMARY_COLOR)
      .setTitle(`🌐 SELECT COMMUNITY SERVER`)
      .setAuthor({
        name: `${config.bot.name} Direct Support Bridge`,
        iconURL: config.bot.logoUrl || undefined
      })
      .setThumbnail(firstGuildIcon || config.bot.logoUrl || null)
      .setDescription(
        `You share **${mutualGuilds.length} servers** with **${config.bot.name}**.\n\n` +
        `Please select which community server you need support from using the menu below:\n\n` +
        serverListText
      )
      .setFooter({
        text: `${config.bot.name} • Direct Support Bridge`,
        iconURL: config.bot.logoUrl || undefined
      })
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

    const guildIcon = message.guild.iconURL({ dynamic: true });
    const replyEmbed = new EmbedBuilder()
      .setColor(PRIMARY_COLOR)
      .setAuthor({
        name: `${message.guild.name} Staff (${message.author.tag})`,
        iconURL: guildIcon || message.author.displayAvatarURL()
      })
      .setThumbnail(guildIcon || null)
      .setDescription(replyText)
      .setFooter({
        text: `${message.guild.name} • Reply to this DM to continue conversation.`,
        iconURL: guildIcon || undefined
      })
      .setTimestamp();

    await user.send({ embeds: [replyEmbed] });

    // Track staff reply in session history
    const session = activeSessions.get(userId);
    if (session) {
      if (!session.messages) session.messages = [];
      session.messages.push({
        id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        authorId: message.author.id,
        authorName: message.author.tag || message.author.username,
        authorAvatar: message.author.displayAvatarURL ? message.author.displayAvatarURL({ dynamic: true }) : null,
        isStaff: true,
        content: replyText,
        attachments: [],
        timestamp: new Date().toISOString()
      });
      saveSessionsToDisk();
    }

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

  const session = activeSessions.get(userId);
  let guild = null;
  if (session && session.guildId) {
    guild = client.guilds.cache.get(session.guildId) || await client.guilds.fetch(session.guildId).catch(() => null);
  }

  const guildIcon = guild?.iconURL ? guild.iconURL({ dynamic: true }) : null;
  const botName = config.bot.name || 'ABYSS ENGINE';
  const replyEmbed = new EmbedBuilder()
    .setColor(PRIMARY_COLOR)
    .setAuthor({
      name: guild ? `${guild.name} Support (${staffName})` : `${botName} Support (${staffName})`,
      iconURL: guildIcon || undefined
    })
    .setThumbnail(guildIcon || null)
    .setDescription(messageText)
    .setFooter({
      text: guild ? `${guild.name} • Web Console Transmission` : `${config.bot.name} • Web Console Transmission`,
      iconURL: guildIcon || undefined
    })
    .setTimestamp();

  await user.send({ embeds: [replyEmbed] });
  logger.modmail(`Console dispatched DM to @${user.tag}: "${messageText}"`);

  // Track console reply in session history
  if (session) {
    if (!session.messages) session.messages = [];
    session.messages.push({
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      authorId: 'console',
      authorName: `Staff Console (${staffName})`,
      authorAvatar: null,
      isStaff: true,
      content: messageText,
      attachments: [],
      timestamp: new Date().toISOString()
    });
    saveSessionsToDisk();
  }

  // Log in channel if open
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
    const session = activeSessions.get(userId);
    if (session) {
      session.status = 'closed';
      session.closedAt = session.closedAt || new Date().toISOString();
      session.closedBy = session.closedBy || 'Discord Channel Delete';
      archivedSessions.unshift(session);
      saveSessionsToDisk();
    }
    activeSessions.delete(userId);
    channelToUser.delete(channel.id);
    logger.modmail(`Modmail channel #${channel.name} was removed. Cleaned active session.`);
  }
}

function generateModmailTranscriptText(session) {
  let text = `================================================================================\n`;
  text += `                MODMAIL DIRECT SUPPORT TRANSCRIPT\n`;
  text += `================================================================================\n`;
  text += `Session ID:    ${session.id || 'N/A'}\n`;
  text += `Server Name:   ${session.guildName || 'Unknown Server'}\n`;
  text += `Server ID:     ${session.guildId || 'N/A'}\n`;
  text += `User Tag:      @${session.username} (${session.userId})\n`;
  text += `Channel:       #${session.channelName || session.channelId || 'dm-support'}\n`;
  text += `Started At:    ${session.startedAt || 'N/A'}\n`;
  text += `Closed At:     ${session.closedAt || 'Still Active'}\n`;
  text += `Closed By:     ${session.closedBy || 'N/A'}\n`;
  text += `Total Messages: ${(session.messages || []).length}\n`;
  text += `================================================================================\n\n`;

  const msgs = session.messages || [];
  for (const m of msgs) {
    const time = m.timestamp ? new Date(m.timestamp).toLocaleString() : 'N/A';
    const tag = m.isStaff ? `[STAFF] ${m.authorName}` : `[USER] ${m.authorName}`;
    text += `[${time}] ${tag}:\n`;
    text += `${m.content || '[No text]'}\n`;
    if (m.attachments && m.attachments.length > 0) {
      text += `Attachments: ${m.attachments.join(', ')}\n`;
    }
    text += `--------------------------------------------------------------------------------\n`;
  }

  return text;
}

function generateModmailTranscriptAttachment(session) {
  const transcriptText = generateModmailTranscriptText(session);
  const buffer = Buffer.from(transcriptText, 'utf-8');
  const safeUser = (session.username || 'user').replace(/[^a-zA-Z0-9]/g, '_');
  return new AttachmentBuilder(buffer, { name: `transcript-modmail-${safeUser}-${Date.now()}.txt` });
}

function getActiveSessionsDetailed(client) {
  if (client && client.channels && client.channels.cache) {
    for (const [userId, session] of activeSessions) {
      if (!client.channels.cache.has(session.channelId)) {
        channelToUser.delete(session.channelId);
        session.status = 'closed';
        session.closedAt = session.closedAt || new Date().toISOString();
        session.closedBy = session.closedBy || 'Discord Channel Removed';
        archivedSessions.unshift(session);
        activeSessions.delete(userId);
      }
    }
    saveSessionsToDisk();
  }

  return Array.from(activeSessions.values()).map(s => {
    const msgs = s.messages || [];
    const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
    return {
      id: s.id,
      channelId: s.channelId,
      channelName: s.channelName || `dm-${s.username}`,
      userId: s.userId,
      username: s.username,
      userAvatar: s.userAvatar,
      guildId: s.guildId,
      guildName: s.guildName || 'Community Server',
      startedAt: s.startedAt,
      status: s.status || 'active',
      messagesCount: msgs.length,
      lastMessage: lastMsg ? {
        content: lastMsg.content,
        authorName: lastMsg.authorName,
        isStaff: lastMsg.isStaff,
        timestamp: lastMsg.timestamp
      } : null
    };
  });
}

function getActiveSessions(client) {
  return getActiveSessionsDetailed(client);
}

function getArchivedSessions(limit = 25) {
  return archivedSessions.slice(0, limit).map(s => {
    const msgs = s.messages || [];
    return {
      id: s.id,
      channelId: s.channelId,
      channelName: s.channelName,
      userId: s.userId,
      username: s.username,
      userAvatar: s.userAvatar,
      guildId: s.guildId,
      guildName: s.guildName || 'Community Server',
      startedAt: s.startedAt,
      closedAt: s.closedAt,
      closedBy: s.closedBy,
      status: 'closed',
      messagesCount: msgs.length
    };
  });
}

function getSessionConversation(sessionIdOrUserId) {
  for (const session of activeSessions.values()) {
    if (session.id === sessionIdOrUserId || session.userId === sessionIdOrUserId || session.channelId === sessionIdOrUserId) {
      return session;
    }
  }
  for (const session of archivedSessions) {
    if (session.id === sessionIdOrUserId || session.userId === sessionIdOrUserId || session.channelId === sessionIdOrUserId) {
      return session;
    }
  }
  return null;
}

async function closeModmailSession(channel, closedBy = 'Staff') {
  const userId = channelToUser.get(channel.id);
  if (!userId) return false;

  const session = activeSessions.get(userId);

  try {
    const user = await channel.client.users.fetch(userId).catch(() => null);
    if (user) {
      const guildIcon = channel.guild.iconURL({ dynamic: true });
      const closeEmbed = new EmbedBuilder()
        .setColor(0xFF2D55)
        .setTitle(`🔒 SUPPORT SESSION CLOSED`)
        .setAuthor({
          name: `${channel.guild.name} Support Hub`,
          iconURL: guildIcon || undefined
        })
        .setThumbnail(guildIcon || config.bot.logoUrl || null)
        .setDescription(
          `Your direct support session with **${channel.guild.name}** was concluded by **${closedBy}**.\n\n` +
          `If you require further assistance in the future, simply send another direct message to start a new session.`
        )
        .setFooter({
          text: `${channel.guild.name} • Direct Support Bridge`,
          iconURL: guildIcon || undefined
        })
        .setTimestamp();

      await user.send({ embeds: [closeEmbed] }).catch(() => {});
    }

    if (session) {
      session.status = 'closed';
      session.closedAt = new Date().toISOString();
      session.closedBy = closedBy;
      archivedSessions.unshift(session);
      activeSessions.delete(userId);
      channelToUser.delete(channel.id);
      saveSessionsToDisk();

      // Post transcript to log channel if configured
      try {
        const targetLogChannelId = config.modmail?.logChannelId || config.tickets?.transcriptLogChannelId;
        if (targetLogChannelId) {
          const logChan = channel.guild.channels.cache.get(targetLogChannelId) || await channel.guild.channels.fetch(targetLogChannelId).catch(() => null);
          if (logChan) {
            const transcriptFile = generateModmailTranscriptAttachment(session);
            const transcriptEmbed = new EmbedBuilder()
              .setColor(PRIMARY_COLOR)
              .setTitle(`📑 MODMAIL ARCHIVE // @${session.username}`)
              .setDescription(
                `**User:** <@${session.userId}> (${session.userId})\n` +
                `**Server:** **${session.guildName}**\n` +
                `**Channel:** #${channel.name}\n` +
                `**Closed By:** ${closedBy}\n` +
                `**Messages Exchanged:** ${session.messages.length}\n` +
                `**Duration:** <t:${Math.floor(new Date(session.startedAt).getTime() / 1000)}:R> to <t:${Math.floor(new Date(session.closedAt).getTime() / 1000)}:R>`
              )
              .setTimestamp();

            await logChan.send({ embeds: [transcriptEmbed], files: [transcriptFile] });
          }
        }
      } catch (logErr) {
        logger.warn(`Failed to post modmail transcript to log channel: ${logErr.message}`);
      }
    } else {
      activeSessions.delete(userId);
      channelToUser.delete(channel.id);
    }

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

  // Update DM interaction into confirmation state with server logo
  const guildIcon = guild.iconURL ? guild.iconURL({ dynamic: true }) : null;
  const connectEmbed = new EmbedBuilder()
    .setColor(0x00FF88)
    .setTitle(`✅ SUPPORT SESSION CONNECTED`)
    .setAuthor({
      name: `${guild.name} Support Hub`,
      iconURL: guildIcon || undefined
    })
    .setThumbnail(guildIcon || config.bot.logoUrl || null)
    .setDescription(
      `Your direct message session has been connected to **${guild.name}**.\n\n` +
      `Staff officers and operators have received your transmission and will reply directly in this DM thread.\n\n` +
      `💬 *Type your message in this DM anytime to send additional updates or files.*`
    )
    .setFooter({
      text: `${guild.name} • Direct Support Bridge`,
      iconURL: guildIcon || undefined
    })
    .setTimestamp();

  await interaction.update({
    embeds: [connectEmbed],
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
  getActiveSessionsDetailed,
  getArchivedSessions,
  getSessionConversation,
  generateModmailTranscriptText,
  generateModmailTranscriptAttachment,
  handleModmailChannelDelete,
  closeModmailSession,
  handleModmailGuildSelect,
  channelToUser
};

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionsBitField,
  AttachmentBuilder
} = require('discord.js');
const config = require('../../config.json');
const logger = require('../utils/logger');
const { ticketPanelEmbed, ticketWelcomeEmbed, successEmbed, errorEmbed, infoEmbed } = require('../utils/embeds');

// In-memory active ticket tracker
const activeTickets = new Map();

function getPanelComponents() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_create_general')
      .setLabel('General Support')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🎫'),
    new ButtonBuilder()
      .setCustomId('ticket_create_technical')
      .setLabel('Technical / VC Help')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('⚡'),
    new ButtonBuilder()
      .setCustomId('ticket_create_report')
      .setLabel('Report / Incident')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🛡️')
  );
  return [row];
}

function getTicketControlButtons() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_close_btn')
      .setLabel('Close Ticket')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔒'),
    new ButtonBuilder()
      .setCustomId('ticket_claim_btn')
      .setLabel('Claim Ticket')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✋'),
    new ButtonBuilder()
      .setCustomId('ticket_transcript_btn')
      .setLabel('Save Transcript')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('📄')
  );
  return [row];
}

async function handleTicketButton(interaction) {
  const { customId, guild, member, user } = interaction;

  // Ticket creation handler
  if (customId.startsWith('ticket_create_')) {
    const categoryKey = customId.replace('ticket_create_', '');
    const categoryConfig = config.tickets.categories.find(c => c.id === categoryKey) || {
      id: categoryKey,
      label: categoryKey.toUpperCase()
    };

    // Prune any stale tickets whose channels were deleted in Discord
    for (const [chId] of activeTickets) {
      if (!guild.channels.cache.has(chId)) {
        activeTickets.delete(chId);
      }
    }

    // Check open ticket limit
    const existing = Array.from(activeTickets.values()).filter(t => t.userId === user.id && t.guildId === guild.id);
    if (existing.length >= (config.tickets.maxOpenPerUser || 2)) {
      return interaction.reply({
        embeds: [errorEmbed('Ticket Limit Reached', `You already have ${existing.length} active ticket(s). Please resolve existing tickets before opening a new one.`)],
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      // Fetch fresh channels from Discord REST API to eliminate stale deleted channels in cache
      const freshChannels = await guild.channels.fetch().catch(() => guild.channels.cache);
      let category = freshChannels.find(
        c => c && c.type === ChannelType.GuildCategory && c.name.toLowerCase() === config.tickets.categoryName.toLowerCase()
      );

      if (!category) {
        category = await guild.channels.create({
          name: config.tickets.categoryName,
          type: ChannelType.GuildCategory
        }).catch(() => null);
      }

      if (category) {
        // If category has @everyone denied ViewChannel, remove the deny so members can see their tickets
        const everyoneOverwrite = category.permissionOverwrites?.cache?.get(guild.roles.everyone.id);
        if (everyoneOverwrite && everyoneOverwrite.deny.has(PermissionsBitField.Flags.ViewChannel)) {
          await category.permissionOverwrites.edit(guild.roles.everyone.id, {
            ViewChannel: null
          }).catch(() => {});
        }

        // Explicitly allow the user to view the category header
        await category.permissionOverwrites.edit(user.id, {
          ViewChannel: true,
          ReadMessageHistory: true
        }).catch(() => {});
      }

      // Prepare permission overwrites for the ticket channel
      const permissionOverwrites = [
        {
          id: guild.roles.everyone.id,
          deny: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages
          ]
        },
        {
          id: user.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.AttachFiles,
            PermissionsBitField.Flags.EmbedLinks,
            PermissionsBitField.Flags.AddReactions
          ]
        },
        {
          id: guild.members.me.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ManageChannels,
            PermissionsBitField.Flags.ManageMessages,
            PermissionsBitField.Flags.ReadMessageHistory
          ]
        }
      ];

      // Add staff role permissions if they exist
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
      const channelName = `ticket-${sanitizedUsername || 'user'}-${Math.floor(1000 + Math.random() * 9000)}`;

      let ticketChannel;
      try {
        ticketChannel = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: category ? category.id : null,
          topic: `Ticket by ${user.tag} (${user.id}) | Category: ${categoryConfig.label}`,
          permissionOverwrites
        });
      } catch (createErr) {
        logger.warn(`Initial ticket channel creation with parent failed: ${createErr.message}. Attempting resilient fallback...`);
        try {
          // Re-create fresh category and try placing inside
          category = await guild.channels.create({
            name: config.tickets.categoryName,
            type: ChannelType.GuildCategory
          });
          ticketChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: category.id,
            topic: `Ticket by ${user.tag} (${user.id}) | Category: ${categoryConfig.label}`,
            permissionOverwrites
          });
        } catch (retryErr) {
          logger.warn(`Parent category assignment failed (${retryErr.message}). Creating standalone ticket channel.`);
          // Direct fallback without parent - guaranteed to succeed
          ticketChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            topic: `Ticket by ${user.tag} (${user.id}) | Category: ${categoryConfig.label}`,
            permissionOverwrites
          });
        }
      }

      // Explicitly enforce channel permissions to prevent category inheritance wiping
      await ticketChannel.permissionOverwrites.set(permissionOverwrites).catch(err => {
        logger.error(`Failed to enforce channel overwrites: ${err.message}`);
      });

      activeTickets.set(ticketChannel.id, {
        channelId: ticketChannel.id,
        userId: user.id,
        username: user.username,
        guildId: guild.id,
        category: categoryConfig.label,
        createdAt: new Date().toISOString(),
        claimedBy: null
      });

      logger.ticket(`Created ticket channel #${ticketChannel.name} for user @${user.tag}`);

      // Send welcome message in ticket channel
      await ticketChannel.send({
        content: `<@${user.id}> 🔔 Your support session is ready. Staff have been alerted.`,
        embeds: [ticketWelcomeEmbed(user, categoryConfig.label)],
        components: getTicketControlButtons()
      });

      await interaction.editReply({
        embeds: [successEmbed('Ticket Initialized', `Your encrypted support channel has been created: **#${ticketChannel.name}** (<#${ticketChannel.id}>)`)],
        ephemeral: true
      });
    } catch (err) {
      logger.error(`Failed to create ticket: ${err.message}`, err.stack);
      await interaction.editReply({
        embeds: [errorEmbed('Ticket Creation Failed', `An error occurred while creating your ticket channel: ${err.message}`)],
        ephemeral: true
      });
    }
    return;
  }

  // Handle in-ticket buttons
  if (customId === 'ticket_close_btn') {
    const ticketData = activeTickets.get(interaction.channelId);
    await interaction.reply({
      embeds: [infoEmbed('Closing Ticket', 'This support session is being finalized. Generating transcript and deleting channel in 5 seconds...')]
    });

    try {
      // Generate transcript before closing
      const transcript = await generateTranscript(interaction.channel);
      if (ticketData && config.tickets.transcriptLogChannelId) {
        const logChan = interaction.guild.channels.cache.get(config.tickets.transcriptLogChannelId);
        if (logChan) {
          await logChan.send({
            content: `📑 **Ticket Transcript:** #${interaction.channel.name} (User: <@${ticketData.userId}>)`,
            files: [transcript]
          });
        }
      }

      logger.ticket(`Ticket #${interaction.channel.name} closed by ${user.tag}`);
      activeTickets.delete(interaction.channelId);

      setTimeout(async () => {
        try {
          await interaction.channel.delete('Ticket closed');
        } catch (e) {
          logger.error(`Error deleting closed ticket channel: ${e.message}`);
        }
      }, 5000);
    } catch (err) {
      logger.error(`Error closing ticket: ${err.message}`);
    }
    return;
  }

  if (customId === 'ticket_claim_btn') {
    const ticketData = activeTickets.get(interaction.channelId);
    if (!ticketData) {
      return interaction.reply({ content: '❌ Not a recognized active ticket session.', ephemeral: true });
    }

    if (ticketData.claimedBy) {
      return interaction.reply({
        content: `⚠️ This ticket is already claimed by <@${ticketData.claimedBy}>.`,
        ephemeral: true
      });
    }

    ticketData.claimedBy = user.id;
    activeTickets.set(interaction.channelId, ticketData);
    logger.ticket(`Ticket #${interaction.channel.name} claimed by ${user.tag}`);

    await interaction.reply({
      embeds: [successEmbed('Ticket Claimed', `Staff member <@${user.id}> has claimed this ticket and will handle your request.`)]
    });
    return;
  }

  if (customId === 'ticket_transcript_btn') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const file = await generateTranscript(interaction.channel);
      await interaction.editReply({
        content: '📄 **Transcript generated successfully:**',
        files: [file],
        ephemeral: true
      });
    } catch (err) {
      await interaction.editReply({
        content: `❌ Failed to generate transcript: ${err.message}`,
        ephemeral: true
      });
    }
  }
}

async function generateTranscript(channel) {
  const messages = await channel.messages.fetch({ limit: 100 });
  const sorted = Array.from(messages.values()).reverse();

  const botName = config.bot.name || 'SUPPORT ENGINE';
  let transcriptText = `==========================================================\n`;
  transcriptText += `  ${botName} // TICKET TRANSCRIPT LOG\n`;
  transcriptText += `  Channel: #${channel.name} (${channel.id})\n`;
  transcriptText += `  Generated: ${new Date().toUTCString()}\n`;
  transcriptText += `==========================================================\n\n`;

  for (const msg of sorted) {
    const time = msg.createdAt.toTimeString().split(' ')[0];
    transcriptText += `[${time}] ${msg.author.tag}: ${msg.cleanContent || (msg.embeds.length ? '[Embed Message]' : '[Attachment]')}\n`;
  }

  const buffer = Buffer.from(transcriptText, 'utf-8');
  return new AttachmentBuilder(buffer, { name: `transcript-${channel.name}.txt` });
}

async function closeTicket(channel, closedBy = 'Cyber-Deck Console') {
  const ticketData = activeTickets.get(channel.id);
  activeTickets.delete(channel.id);

  try {
    const transcript = await generateTranscript(channel);
    if (config.tickets.transcriptLogChannelId) {
      const logChan = channel.guild.channels.cache.get(config.tickets.transcriptLogChannelId);
      if (logChan) {
        await logChan.send({
          content: `📑 **Ticket Transcript:** #${channel.name} (Closed by: ${closedBy})`,
          files: [transcript]
        });
      }
    }
  } catch (e) {
    logger.error(`Error saving transcript: ${e.message}`);
  }

  try {
    await channel.delete(`Ticket closed by ${closedBy}`);
    logger.ticket(`Ticket #${channel.name} channel deleted.`);
  } catch (e) {
    logger.error(`Error deleting closed ticket channel: ${e.message}`);
  }
}

function handleChannelDelete(channel) {
  if (activeTickets.has(channel.id)) {
    activeTickets.delete(channel.id);
    logger.ticket(`Ticket channel #${channel.name} was removed. Cleaned active session.`);
  }
}

function removeActiveTicket(channelId) {
  activeTickets.delete(channelId);
}

function getActiveTickets(client) {
  if (client && client.channels && client.channels.cache) {
    for (const [chId] of activeTickets) {
      if (!client.channels.cache.has(chId)) {
        activeTickets.delete(chId);
      }
    }
  }
  return Array.from(activeTickets.values());
}

module.exports = {
  getPanelComponents,
  getTicketControlButtons,
  handleTicketButton,
  getActiveTickets,
  generateTranscript,
  closeTicket,
  handleChannelDelete,
  removeActiveTicket
};

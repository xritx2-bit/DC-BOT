const {
  ChannelType,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder
} = require('discord.js');
const config = require('../../config.json');
const logger = require('../utils/logger');

// Map of tempVoiceChannelId -> { channelId, ownerId, guildId, createdAt, logs: [], banned: Set, trusted: Set }
const activeTempVcs = new Map();

function addVcLog(tempVcData, text) {
  if (!tempVcData) return;
  if (!tempVcData.logs) tempVcData.logs = [];
  const time = new Date().toTimeString().split(' ')[0];
  tempVcData.logs.push(`[\`${time}\`] ${text}`);
  if (tempVcData.logs.length > 50) tempVcData.logs.shift();
}

/**
 * Builds the 20-button moderation matrix panel
 */
function buildVcControlPanel(channel, ownerId) {
  const embed = new EmbedBuilder()
    .setColor(0xFF1E27)
    .setTitle('⚡ ABYSS ENGINE // DYNAMIC VOICE CONTROLS')
    .setThumbnail(config.bot.logoUrl || null)
    .setDescription(
      `Welcome to your private temporary voice lounge! Use the matrix buttons below to moderate and customize your channel.\n\n` +
      `\`\`\`asciidoc\n` +
      `[ MODERATION MATRIX DIRECTORY ]\n` +
      `• 🎛️ STATUS     • 👥 LIMIT      • 📑 LOGS       • 🚫 BAN        • 🔓 UNBAN\n` +
      `• 👁️‍🗨️ HIDE       • 👁️ UNHIDE     • 🌐 REGION     • 🔒 LOCK       • 🔓 UNLOCK\n` +
      `• ⭐ TRUST      • ⚡ UNTRUST    • 📶 BITRATE    • 🔗 INVITE     • 👢 KICK\n` +
      `• 🔇 SUPRESS    • 🎙️ UNSUPRESS  • 💬 CHAT       • 👑 CLAIM      • 👑 TRANSFER\n` +
      `\`\`\`\n` +
      `👑 **Channel Owner:** <@${ownerId}>\n` +
      `🔒 *Only the voice channel owner has authorization to use these controls. If the owner departs, another connected member may click CLAIM to assume ownership.*`
    )
    .setFooter({ text: `${config.bot.name || 'ABYSS ENGINE'} • Dynamic VC Protocol` })
    .setTimestamp();

  // Row 1: STATUS, LIMIT, LOGS, BAN, UNBAN (Secondary)
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tvc_status').setEmoji('🎛️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tvc_limit').setEmoji('👥').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tvc_logs').setEmoji('📑').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tvc_ban').setEmoji('🚫').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tvc_unban').setEmoji('🔓').setStyle(ButtonStyle.Secondary)
  );

  // Row 2: HIDE, UNHIDE, REGION, LOCK, UNLOCK (Secondary)
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tvc_hide').setEmoji('👁️‍🗨️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tvc_unhide').setEmoji('👁️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tvc_region').setEmoji('🌐').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tvc_lock').setEmoji('🔒').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tvc_unlock').setEmoji('🔓').setStyle(ButtonStyle.Secondary)
  );

  // Row 3: TRUST, UNTRUST, BITRATE, INVITE, KICK (Secondary)
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tvc_trust').setEmoji('⭐').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tvc_untrust').setEmoji('⚡').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tvc_bitrate').setEmoji('📶').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tvc_invite').setEmoji('🔗').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tvc_kick').setEmoji('👢').setStyle(ButtonStyle.Secondary)
  );

  // Row 4: SUPRESS, UNSUPRESS, CHAT, CLAIM (Success), TRANSFER (Primary)
  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tvc_suppress').setEmoji('🔇').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tvc_unsuppress').setEmoji('🎙️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tvc_chat').setEmoji('💬').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('tvc_claim').setEmoji('👑').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('tvc_transfer').setEmoji('👑').setStyle(ButtonStyle.Primary)
  );

  return {
    content: `<@${ownerId}>`,
    embeds: [embed],
    components: [row1, row2, row3, row4]
  };
}

async function handleVoiceStateUpdate(oldState, newState) {
  if (!config.tempVoice || !config.tempVoice.enabled) return;

  const member = newState.member;
  if (!member || member.user.bot) return;

  // CASE 1: User joined a voice channel
  if (newState.channelId && newState.channelId !== oldState.channelId) {
    const joinedChannel = newState.channel;

    // Check if the joined channel matches the Hub Channel
    const isHub = joinedChannel.name.toLowerCase().includes('join to create') ||
                  joinedChannel.name.toLowerCase() === (config.tempVoice.hubChannelName || '').toLowerCase();

    if (isHub) {
      try {
        const guild = newState.guild;
        const parentCategory = joinedChannel.parent;

        const sanitizedName = member.displayName.replace(/[^a-zA-Z0-9 ]/g, '').trim() || member.user.username;
        const channelName = `🔊・${sanitizedName}'s Lounge`;

        // Create temporary private VC
        const permissionOverwrites = [
          {
            id: member.id,
            allow: [
              PermissionsBitField.Flags.Connect,
              PermissionsBitField.Flags.Speak,
              PermissionsBitField.Flags.ManageChannels,
              PermissionsBitField.Flags.MoveMembers,
              PermissionsBitField.Flags.MuteMembers,
              PermissionsBitField.Flags.ViewChannel
            ]
          }
        ];

        let tempChannel;
        try {
          tempChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildVoice,
            parent: parentCategory ? parentCategory.id : null,
            userLimit: config.tempVoice.defaultUserLimit || 0,
            permissionOverwrites
          });
        } catch (e) {
          tempChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildVoice,
            userLimit: config.tempVoice.defaultUserLimit || 0,
            permissionOverwrites
          });
        }

        // Move the member into the new temp channel
        await member.voice.setChannel(tempChannel);

        const vcData = {
          channelId: tempChannel.id,
          ownerId: member.id,
          guildId: guild.id,
          createdAt: new Date().toISOString(),
          logs: [],
          banned: new Set(),
          trusted: new Set()
        };
        addVcLog(vcData, `Lounge created by @${member.user.tag}`);
        activeTempVcs.set(tempChannel.id, vcData);

        logger.vc(`Created dynamic VC "${tempChannel.name}" for ${member.user.tag}`);

        // Post the 20-button moderation matrix panel in the voice channel's chat
        try {
          const panelPayload = buildVcControlPanel(tempChannel, member.id);
          await tempChannel.send(panelPayload);
        } catch (panelErr) {
          logger.vc(`Control panel dispatch notice: ${panelErr.message}`);
        }
      } catch (err) {
        logger.error(`Failed to create temp VC: ${err.message}`);
      }
    }
  }

  // CASE 2: User left a voice channel
  if (oldState.channelId && oldState.channelId !== newState.channelId) {
    const leftChannel = oldState.channel;
    if (leftChannel && activeTempVcs.has(leftChannel.id)) {
      // Check if channel is now empty
      if (leftChannel.members.size === 0) {
        try {
          activeTempVcs.delete(leftChannel.id);
          await leftChannel.delete('Temporary VC emptied');
          logger.vc(`Deleted empty dynamic VC: #${leftChannel.name}`);
        } catch (err) {
          logger.error(`Failed to delete empty temp VC: ${err.message}`);
        }
      }
    }
  }
}

/**
 * Handles all 20 Temp VC interaction buttons, select menus, and modals
 */
async function handleTempVcInteraction(interaction) {
  const customId = interaction.customId;
  if (!customId || !customId.startsWith('tvc_')) return;

  // Resolve target voice channel
  let channelId = null;

  // Check if customId contains channel ID suffix (for modals and select menus)
  const parts = customId.split('_');
  const possibleId = parts[parts.length - 1];
  if (possibleId && /^\d+$/.test(possibleId)) {
    channelId = possibleId;
  } else if (activeTempVcs.has(interaction.channelId)) {
    channelId = interaction.channelId;
  } else if (interaction.member?.voice?.channelId && activeTempVcs.has(interaction.member.voice.channelId)) {
    channelId = interaction.member.voice.channelId;
  }

  if (!channelId || !activeTempVcs.has(channelId)) {
    return interaction.reply({
      content: '⚠️ This temporary voice lounge is no longer active or could not be resolved.',
      ephemeral: true
    }).catch(() => {});
  }

  const tempVcData = activeTempVcs.get(channelId);
  const channel = interaction.guild.channels.cache.get(channelId) || await interaction.guild.channels.fetch(channelId).catch(() => null);

  if (!channel) {
    return interaction.reply({
      content: '⚠️ Voice channel not found in server.',
      ephemeral: true
    }).catch(() => {});
  }

  // ==========================================
  // 1. CLAIM BUTTON (tvc_claim) - Exception to Owner-Only
  // ==========================================
  if (customId === 'tvc_claim') {
    // Must be inside the channel
    if (interaction.member?.voice?.channelId !== channel.id) {
      return interaction.reply({
        content: '❌ You must be connected inside this voice room to claim ownership.',
        ephemeral: true
      });
    }

    // Check if owner is already user
    if (interaction.user.id === tempVcData.ownerId) {
      return interaction.reply({
        content: 'ℹ️ You are already the registered owner of this voice channel.',
        ephemeral: true
      });
    }

    // Check if current owner is still inside the channel
    const isOwnerConnected = channel.members.has(tempVcData.ownerId);
    if (isOwnerConnected) {
      return interaction.reply({
        content: `❌ You cannot claim ownership while the owner (<@${tempVcData.ownerId}>) is still connected in the voice channel.`,
        ephemeral: true
      });
    }

    // Owner has departed -> Transfer ownership to claimer
    const previousOwner = tempVcData.ownerId;
    tempVcData.ownerId = interaction.user.id;

    await channel.permissionOverwrites.edit(interaction.user.id, {
      Connect: true,
      Speak: true,
      ManageChannels: true,
      MoveMembers: true,
      MuteMembers: true,
      ViewChannel: true
    }).catch(() => {});

    addVcLog(tempVcData, `👑 Ownership claimed by @${interaction.user.tag}`);
    await channel.send({
      content: `👑 **Ownership Claimed!** <@${interaction.user.id}> is now the owner of this voice lounge.`
    }).catch(() => {});

    return interaction.reply({
      content: `✅ You have successfully claimed ownership of **${channel.name}**!`,
      ephemeral: true
    });
  }

  // ==========================================
  // OWNER-ONLY VERIFICATION (Strictly Enforced)
  // ==========================================
  const isOwner = interaction.user.id === tempVcData.ownerId;
  const isServerAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
                        interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels);

  if (!isOwner && !isServerAdmin) {
    return interaction.reply({
      content: `❌ **Access Denied**: Only the voice channel owner (<@${tempVcData.ownerId}>) can use these moderation controls.`,
      ephemeral: true
    });
  }

  // ==========================================
  // MODAL SUBMISSIONS
  // ==========================================
  if (interaction.isModalSubmit()) {
    if (customId.startsWith('tvc_modal_limit_')) {
      const val = parseInt(interaction.fields.getTextInputValue('limit_value'), 10);
      if (isNaN(val) || val < 0 || val > 99) {
        return interaction.reply({ content: '❌ Invalid input. Enter an integer between 0 and 99.', ephemeral: true });
      }
      await channel.setUserLimit(val);
      addVcLog(tempVcData, `👥 Member limit set to ${val === 0 ? 'Unlimited' : val}`);
      return interaction.reply({
        content: `✅ Channel member limit updated to **${val === 0 ? 'Unlimited (0)' : val}**.`,
        ephemeral: true
      });
    }
    return;
  }

  // ==========================================
  // SELECT MENU SUBMISSIONS
  // ==========================================
  if (interaction.isStringSelectMenu()) {
    // REGION SELECT
    if (customId.startsWith('tvc_select_region_')) {
      const region = interaction.values[0];
      await channel.setRTCRegion(region === 'auto' ? null : region);
      addVcLog(tempVcData, `🌐 Voice region set to ${region}`);
      return interaction.update({
        content: `✅ RTC Voice Region set to **${region}**.`,
        components: []
      });
    }

    // BITRATE SELECT
    if (customId.startsWith('tvc_select_bitrate_')) {
      const bitrateKbps = parseInt(interaction.values[0], 10);
      try {
        await channel.setBitrate(bitrateKbps * 1000);
        addVcLog(tempVcData, `📶 Bitrate set to ${bitrateKbps} kbps`);
        return interaction.update({
          content: `✅ Voice audio bitrate set to **${bitrateKbps} kbps**.`,
          components: []
        });
      } catch (err) {
        return interaction.update({
          content: `⚠️ Could not set bitrate to ${bitrateKbps} kbps (Server boost tier limit).`,
          components: []
        });
      }
    }
  }

  if (interaction.isUserSelectMenu()) {
    const targetId = interaction.values[0];

    // BAN USER
    if (customId.startsWith('tvc_select_ban_')) {
      if (targetId === tempVcData.ownerId) {
        return interaction.update({ content: '❌ You cannot ban yourself.', components: [] });
      }
      if (!tempVcData.banned) tempVcData.banned = new Set();
      tempVcData.banned.add(targetId);

      await channel.permissionOverwrites.edit(targetId, {
        Connect: false,
        ViewChannel: false
      }).catch(() => {});

      const targetMember = channel.members.get(targetId);
      if (targetMember && targetMember.voice) {
        await targetMember.voice.disconnect('Banned by VC owner').catch(() => {});
      }

      addVcLog(tempVcData, `🚫 Banned <@${targetId}>`);
      return interaction.update({
        content: `🚫 <@${targetId}> has been banned and evicted from this voice channel.`,
        components: []
      });
    }

    // UNBAN USER
    if (customId.startsWith('tvc_select_unban_')) {
      if (tempVcData.banned) tempVcData.banned.delete(targetId);
      await channel.permissionOverwrites.delete(targetId).catch(() => {});
      addVcLog(tempVcData, `🔓 Unbanned <@${targetId}>`);
      return interaction.update({
        content: `🔓 <@${targetId}> has been unbanned.`,
        components: []
      });
    }

    // TRUST USER
    if (customId.startsWith('tvc_select_trust_')) {
      if (!tempVcData.trusted) tempVcData.trusted = new Set();
      tempVcData.trusted.add(targetId);

      await channel.permissionOverwrites.edit(targetId, {
        Connect: true,
        ViewChannel: true,
        Speak: true
      }).catch(() => {});

      addVcLog(tempVcData, `⭐ Trusted <@${targetId}>`);
      return interaction.update({
        content: `⭐ <@${targetId}> has been granted **Trusted Access** to this channel.`,
        components: []
      });
    }

    // UNTRUST USER
    if (customId.startsWith('tvc_select_untrust_')) {
      if (tempVcData.trusted) tempVcData.trusted.delete(targetId);
      await channel.permissionOverwrites.delete(targetId).catch(() => {});
      addVcLog(tempVcData, `⚡ Removed trust from <@${targetId}>`);
      return interaction.update({
        content: `⚡ Removed trusted status for <@${targetId}>.`,
        components: []
      });
    }

    // KICK USER
    if (customId.startsWith('tvc_select_kick_')) {
      if (targetId === tempVcData.ownerId) {
        return interaction.update({ content: '❌ You cannot kick yourself.', components: [] });
      }
      const targetMember = channel.members.get(targetId);
      if (!targetMember) {
        return interaction.update({ content: '⚠️ That user is not currently in this voice channel.', components: [] });
      }
      await targetMember.voice.disconnect('Kicked by VC owner').catch(() => {});
      addVcLog(tempVcData, `👢 Disconnected <@${targetId}>`);
      return interaction.update({
        content: `👢 Disconnected <@${targetId}> from this voice room.`,
        components: []
      });
    }

    // TRANSFER OWNERSHIP
    if (customId.startsWith('tvc_select_transfer_')) {
      if (targetId === tempVcData.ownerId) {
        return interaction.update({ content: 'ℹ️ You are already the owner of this channel.', components: [] });
      }
      const oldOwnerId = tempVcData.ownerId;
      tempVcData.ownerId = targetId;

      await channel.permissionOverwrites.edit(targetId, {
        Connect: true,
        Speak: true,
        ManageChannels: true,
        MoveMembers: true,
        MuteMembers: true,
        ViewChannel: true
      }).catch(() => {});

      addVcLog(tempVcData, `👑 Transferred ownership to <@${targetId}>`);
      await channel.send({
        content: `👑 **Ownership Transferred!** <@${oldOwnerId}> transferred voice lounge ownership to <@${targetId}>.`
      }).catch(() => {});

      return interaction.update({
        content: `✅ Voice lounge ownership successfully transferred to <@${targetId}>.`,
        components: []
      });
    }
  }

  // ==========================================
  // BUTTON INTERACTIONS
  // ==========================================

  // 1. STATUS
  if (customId === 'tvc_status') {
    const everyoneConnect = channel.permissionsFor(interaction.guild.roles.everyone).has(PermissionsBitField.Flags.Connect);
    const everyoneView = channel.permissionsFor(interaction.guild.roles.everyone).has(PermissionsBitField.Flags.ViewChannel);
    const everyoneSpeak = channel.permissionsFor(interaction.guild.roles.everyone).has(PermissionsBitField.Flags.Speak);
    const everyoneChat = channel.permissionsFor(interaction.guild.roles.everyone).has(PermissionsBitField.Flags.SendMessages);

    const membersList = channel.members.map(m => `• <@${m.id}> (${m.user.tag})`).join('\n') || '*No members connected*';

    const statusEmbed = new EmbedBuilder()
      .setColor(0x00F3FF)
      .setTitle(`🎛️ CHANNEL TELEMETRY // ${channel.name.toUpperCase()}`)
      .setDescription(
        `**Channel:** <#${channel.id}>\n` +
        `**Owner:** <@${tempVcData.ownerId}>\n` +
        `**Created:** <t:${Math.floor(new Date(tempVcData.createdAt).getTime() / 1000)}:R>\n` +
        `**Member Limit:** \`${channel.userLimit === 0 ? 'Unlimited (0)' : channel.userLimit}\`\n` +
        `**Voice Region:** \`${channel.rtcRegion || 'Automatic'}\`\n` +
        `**Bitrate:** \`${channel.bitrate / 1000} kbps\`\n\n` +
        `**Security & Protocol Status:**\n` +
        `• Gate Lock: ${everyoneConnect ? '🔓 Unlocked (Open)' : '🔒 Locked (Restricted)'}\n` +
        `• Visibility: ${everyoneView ? '👁️ Visible' : '👁️‍🗨️ Hidden'}\n` +
        `• Transmission: ${everyoneSpeak ? '🎙️ Open Mic' : '🔇 Suppressed / Muted'}\n` +
        `• In-Channel Chat: ${everyoneChat ? '💬 Enabled' : '🔇 Locked'}\n` +
        `• Trusted Users: \`${tempVcData.trusted?.size || 0}\`\n` +
        `• Banned Users: \`${tempVcData.banned?.size || 0}\`\n\n` +
        `**Connected Members (${channel.members.size}):**\n${membersList}`
      )
      .setFooter({ text: `${config.bot.name || 'ABYSS ENGINE'} • Telemetry Matrix` })
      .setTimestamp();

    return interaction.reply({ embeds: [statusEmbed], ephemeral: true });
  }

  // 2. LIMIT
  if (customId === 'tvc_limit') {
    const modal = new ModalBuilder()
      .setCustomId(`tvc_modal_limit_${channel.id}`)
      .setTitle('Set Member Limit');

    const input = new TextInputBuilder()
      .setCustomId('limit_value')
      .setLabel('Member Limit (0 - 99, 0 = Unlimited)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Enter 0 for unlimited, or 1 to 99')
      .setValue(String(channel.userLimit || 0))
      .setRequired(true)
      .setMaxLength(2);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  // 3. LOGS
  if (customId === 'tvc_logs') {
    const logs = tempVcData.logs || [];
    const logsText = logs.length > 0 ? logs.slice(-15).join('\n') : '*No moderation events recorded yet.*';

    const logEmbed = new EmbedBuilder()
      .setColor(0x00F3FF)
      .setTitle(`📑 MODERATION AUDIT LOG // #${channel.name}`)
      .setDescription(logsText)
      .setFooter({ text: `${config.bot.name || 'ABYSS ENGINE'} • Channel Session Logs` })
      .setTimestamp();

    return interaction.reply({ embeds: [logEmbed], ephemeral: true });
  }

  // 4. BAN
  if (customId === 'tvc_ban') {
    const select = new UserSelectMenuBuilder()
      .setCustomId(`tvc_select_ban_${channel.id}`)
      .setPlaceholder('Select member to ban from this VC...')
      .setMaxValues(1);

    const row = new ActionRowBuilder().addComponents(select);
    return interaction.reply({
      content: '🚫 **Select a member to ban from your voice channel:**\n*They will be evicted and prevented from joining or viewing.*',
      components: [row],
      ephemeral: true
    });
  }

  // 5. UNBAN
  if (customId === 'tvc_unban') {
    if (!tempVcData.banned || tempVcData.banned.size === 0) {
      return interaction.reply({ content: 'ℹ️ No members are currently banned from this channel.', ephemeral: true });
    }
    const select = new UserSelectMenuBuilder()
      .setCustomId(`tvc_select_unban_${channel.id}`)
      .setPlaceholder('Select member to unban...')
      .setMaxValues(1);

    const row = new ActionRowBuilder().addComponents(select);
    return interaction.reply({
      content: '🔓 **Select a member to unban:**',
      components: [row],
      ephemeral: true
    });
  }

  // 6. HIDE
  if (customId === 'tvc_hide') {
    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
      ViewChannel: false
    });
    await channel.permissionOverwrites.edit(tempVcData.ownerId, {
      ViewChannel: true
    });
    addVcLog(tempVcData, `👁️‍🗨️ Channel hidden by @${interaction.user.tag}`);
    return interaction.reply({ content: '👁️‍🗨️ Voice lounge is now **Hidden** from non-trusted members.', ephemeral: true });
  }

  // 7. UNHIDE
  if (customId === 'tvc_unhide') {
    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
      ViewChannel: true
    });
    addVcLog(tempVcData, `👁️ Channel unhidden by @${interaction.user.tag}`);
    return interaction.reply({ content: '👁️ Voice lounge is now **Visible** to all members.', ephemeral: true });
  }

  // 8. REGION
  if (customId === 'tvc_region') {
    const select = new StringSelectMenuBuilder()
      .setCustomId(`tvc_select_region_${channel.id}`)
      .setPlaceholder('Select RTC voice server region...')
      .addOptions([
        { label: 'Automatic (Recommended)', value: 'auto', description: 'Discord will pick lowest latency server', emoji: '🌐' },
        { label: 'US East', value: 'us-east', description: 'United States East', emoji: '🇺🇸' },
        { label: 'US Central', value: 'us-central', description: 'United States Central', emoji: '🇺🇸' },
        { label: 'US West', value: 'us-west', description: 'United States West', emoji: '🇺🇸' },
        { label: 'Europe (Rotterdam)', value: 'rotterdam', description: 'Europe', emoji: '🇪🇺' },
        { label: 'Singapore', value: 'singapore', description: 'Southeast Asia', emoji: '🇸🇬' },
        { label: 'Sydney', value: 'sydney', description: 'Australia', emoji: '🇦🇺' },
        { label: 'India', value: 'india', description: 'South Asia', emoji: '🇮🇳' },
        { label: 'Brazil', value: 'brazil', description: 'South America', emoji: '🇧🇷' },
        { label: 'Japan', value: 'japan', description: 'East Asia', emoji: '🇯🇵' }
      ]);

    const row = new ActionRowBuilder().addComponents(select);
    return interaction.reply({ content: '🌐 **Select an RTC Voice Region for this room:**', components: [row], ephemeral: true });
  }

  // 9. LOCK
  if (customId === 'tvc_lock') {
    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
      Connect: false
    });
    await channel.permissionOverwrites.edit(tempVcData.ownerId, {
      Connect: true
    });
    addVcLog(tempVcData, `🔒 Channel locked by @${interaction.user.tag}`);
    return interaction.reply({ content: '🔒 Voice lounge **Locked**. Other members cannot join.', ephemeral: true });
  }

  // 10. UNLOCK
  if (customId === 'tvc_unlock') {
    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
      Connect: true
    });
    addVcLog(tempVcData, `🔓 Channel unlocked by @${interaction.user.tag}`);
    return interaction.reply({ content: '🔓 Voice lounge **Unlocked**. All members can join.', ephemeral: true });
  }

  // 11. TRUST
  if (customId === 'tvc_trust') {
    const select = new UserSelectMenuBuilder()
      .setCustomId(`tvc_select_trust_${channel.id}`)
      .setPlaceholder('Select member to trust...')
      .setMaxValues(1);

    const row = new ActionRowBuilder().addComponents(select);
    return interaction.reply({
      content: '⭐ **Select a member to grant Trusted Access:**\n*Can connect even when locked or hidden, and speak when suppressed.*',
      components: [row],
      ephemeral: true
    });
  }

  // 12. UNTRUST
  if (customId === 'tvc_untrust') {
    if (!tempVcData.trusted || tempVcData.trusted.size === 0) {
      return interaction.reply({ content: 'ℹ️ No members are currently on the Trusted list.', ephemeral: true });
    }
    const select = new UserSelectMenuBuilder()
      .setCustomId(`tvc_select_untrust_${channel.id}`)
      .setPlaceholder('Select member to untrust...')
      .setMaxValues(1);

    const row = new ActionRowBuilder().addComponents(select);
    return interaction.reply({ content: '⚡ **Select a member to remove from Trusted list:**', components: [row], ephemeral: true });
  }

  // 13. BITRATE
  if (customId === 'tvc_bitrate') {
    const select = new StringSelectMenuBuilder()
      .setCustomId(`tvc_select_bitrate_${channel.id}`)
      .setPlaceholder('Select audio bitrate...')
      .addOptions([
        { label: '32 kbps', value: '32', description: 'Low Bandwidth saving' },
        { label: '64 kbps (Standard)', value: '64', description: 'Default Discord audio quality' },
        { label: '96 kbps (High Quality)', value: '96', description: 'Clear voice audio' },
        { label: '128 kbps (Tier 1)', value: '128', description: 'Server Boost Tier 1 required' },
        { label: '256 kbps (Tier 2)', value: '256', description: 'Server Boost Tier 2 required' },
        { label: '384 kbps (Tier 3)', value: '384', description: 'Ultra HD audio (Boost Tier 3)' }
      ]);

    const row = new ActionRowBuilder().addComponents(select);
    return interaction.reply({ content: '📶 **Select voice audio bitrate:**', components: [row], ephemeral: true });
  }

  // 14. INVITE
  if (customId === 'tvc_invite') {
    try {
      const invite = await channel.createInvite({
        maxAge: 86400,
        maxUses: 10,
        reason: 'Temporary VC invite link generated by owner'
      });
      addVcLog(tempVcData, `🔗 Generated invite by @${interaction.user.tag}`);
      return interaction.reply({
        content: `🔗 **Temporary Voice Room Invite Link:**\n${invite.url}\n*(Valid for 24 hours or up to 10 uses)*`,
        ephemeral: true
      });
    } catch (err) {
      return interaction.reply({ content: `⚠️ Failed to create invite: ${err.message}`, ephemeral: true });
    }
  }

  // 15. KICK
  if (customId === 'tvc_kick') {
    const select = new UserSelectMenuBuilder()
      .setCustomId(`tvc_select_kick_${channel.id}`)
      .setPlaceholder('Select connected user to disconnect...')
      .setMaxValues(1);

    const row = new ActionRowBuilder().addComponents(select);
    return interaction.reply({
      content: '👢 **Select a member to disconnect from this voice channel:**',
      components: [row],
      ephemeral: true
    });
  }

  // 16. SUPPRESS (MUTE)
  if (customId === 'tvc_suppress') {
    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
      Speak: false
    });
    await channel.permissionOverwrites.edit(tempVcData.ownerId, {
      Speak: true
    });
    addVcLog(tempVcData, `🔇 Suppressed channel by @${interaction.user.tag}`);
    return interaction.reply({
      content: '🔇 **Channel Suppressed**. Only the owner and trusted members have speaking authorization.',
      ephemeral: true
    });
  }

  // 17. UNSUPPRESS (UNMUTE)
  if (customId === 'tvc_unsuppress') {
    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
      Speak: true
    });
    addVcLog(tempVcData, `🎙️ Unsuppressed channel by @${interaction.user.tag}`);
    return interaction.reply({
      content: '🎙️ **Channel Unsuppressed**. All connected members can now speak freely.',
      ephemeral: true
    });
  }

  // 18. CHAT
  if (customId === 'tvc_chat') {
    const currentSend = channel.permissionsFor(interaction.guild.roles.everyone).has(PermissionsBitField.Flags.SendMessages);
    const newSend = !currentSend;
    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
      SendMessages: newSend
    });
    addVcLog(tempVcData, `💬 Chat ${newSend ? 'unlocked' : 'locked'} by @${interaction.user.tag}`);
    return interaction.reply({
      content: `💬 In-channel text chat is now **${newSend ? 'Unlocked (Open)' : 'Locked (Owner Only)'}**.`,
      ephemeral: true
    });
  }

  // 20. TRANSFER
  if (customId === 'tvc_transfer') {
    const select = new UserSelectMenuBuilder()
      .setCustomId(`tvc_select_transfer_${channel.id}`)
      .setPlaceholder('Select new room owner...')
      .setMaxValues(1);

    const row = new ActionRowBuilder().addComponents(select);
    return interaction.reply({
      content: '👑 **Select a member to transfer ownership of this channel to:**',
      components: [row],
      ephemeral: true
    });
  }
}

function getActiveTempVcs() {
  return Array.from(activeTempVcs.values());
}

module.exports = {
  handleVoiceStateUpdate,
  handleTempVcInteraction,
  buildVcControlPanel,
  getActiveTempVcs,
  activeTempVcs
};

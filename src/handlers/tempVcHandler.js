const { ChannelType, PermissionsBitField } = require('discord.js');
const config = require('../../config.json');
const logger = require('../utils/logger');

// Map of tempVoiceChannelId -> { ownerId, guildId, createdAt }
const activeTempVcs = new Map();

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
        const tempChannel = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildVoice,
          parent: parentCategory ? parentCategory.id : null,
          userLimit: config.tempVoice.defaultUserLimit || 0,
          permissionOverwrites: [
            {
              id: member.id,
              allow: [
                PermissionsBitField.Flags.Connect,
                PermissionsBitField.Flags.Speak,
                PermissionsBitField.Flags.ManageChannels,
                PermissionsBitField.Flags.MoveMembers,
                PermissionsBitField.Flags.MuteMembers
              ]
            }
          ]
        });

        // Move the member into the new temp channel
        await member.voice.setChannel(tempChannel);

        activeTempVcs.set(tempChannel.id, {
          channelId: tempChannel.id,
          ownerId: member.id,
          guildId: guild.id,
          createdAt: new Date().toISOString()
        });

        logger.vc(`Created dynamic VC "${tempChannel.name}" for ${member.user.tag}`);
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

function getActiveTempVcs() {
  return Array.from(activeTempVcs.values());
}

module.exports = {
  handleVoiceStateUpdate,
  getActiveTempVcs,
  activeTempVcs
};

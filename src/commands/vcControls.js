const { PermissionsBitField } = require('discord.js');
const { activeTempVcs, buildVcControlPanel } = require('../handlers/tempVcHandler');
const { successEmbed, errorEmbed } = require('../utils/embeds');

module.exports = {
  name: 'vc',
  description: 'Manage dynamic temporary voice channels',
  execute: async (message, args, cmdName) => {
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
      return message.reply({
        embeds: [errorEmbed('Voice Required', 'You must be connected to your dynamic voice channel to use this command.')]
      });
    }

    const tempVcData = activeTempVcs.get(voiceChannel.id);
    if (!tempVcData) {
      return message.reply({
        embeds: [errorEmbed('Not a Dynamic VC', 'This command only applies to temporary voice lounges created by the server engine.')]
      });
    }

    if (tempVcData.ownerId !== message.author.id && !message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
      return message.reply({
        embeds: [errorEmbed('Ownership Required', 'Only the creator of this voice channel or an administrator can modify its parameters.')]
      });
    }

    const sub = (cmdName || args[0] || '').toLowerCase();

    // VCPANEL / PANEL
    if (sub === 'vcpanel' || sub === 'panel' || sub === 'vchelp' || sub === 'vc') {
      const panelPayload = buildVcControlPanel(voiceChannel, tempVcData.ownerId);
      return message.reply(panelPayload);
    }

    if (sub === 'vclock' || sub === 'lock') {
      await voiceChannel.permissionOverwrites.edit(message.guild.roles.everyone, {
        Connect: false
      });
      return message.reply({
        embeds: [successEmbed('Channel Locked', `🔒 <#${voiceChannel.id}> is now locked. New members cannot join.`)]
      });
    }

    if (sub === 'vcunlock' || sub === 'unlock') {
      await voiceChannel.permissionOverwrites.edit(message.guild.roles.everyone, {
        Connect: true
      });
      return message.reply({
        embeds: [successEmbed('Channel Unlocked', `🔓 <#${voiceChannel.id}> is now open for other members.`)]
      });
    }

    if (sub === 'vclimit' || sub === 'limit') {
      const limit = parseInt(args[1] || args[0], 10);
      if (isNaN(limit) || limit < 0 || limit > 99) {
        return message.reply({
          embeds: [errorEmbed('Invalid Limit', 'Please specify a user limit between 0 (unlimited) and 99.')]
        });
      }
      await voiceChannel.setUserLimit(limit);
      return message.reply({
        embeds: [successEmbed('Limit Updated', `👥 <#${voiceChannel.id}> member limit set to **${limit === 0 ? 'Unlimited' : limit}**.`)]
      });
    }

    return message.reply({
      embeds: [
        errorEmbed(
          'Unknown VC Command',
          'Use `?vcpanel` to open the 20-button moderation matrix, or `?vclock`, `?vcunlock`, `?vclimit <1-99>`.'
        )
      ]
    });
  }
};

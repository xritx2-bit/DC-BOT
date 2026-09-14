const { ChannelType, PermissionsBitField } = require('discord.js');
const config = require('../../config.json');
const { successEmbed, errorEmbed } = require('../utils/embeds');

module.exports = {
  name: 'vchub',
  description: 'Deploys the "Join to Create VC" hub and voice channel category',
  execute: async (message, args) => {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels) &&
        !message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply({
        embeds: [errorEmbed('Access Denied', 'You require `Manage Channels` permission to configure the VC Hub.')]
      });
    }

    try {
      const guild = message.guild;
      const categoryName = config.tempVoice.categoryName || 'VOICE CHANNELS';
      const hubName = config.tempVoice.hubChannelName || '➕ Join to Create VC';

      const freshChannels = await guild.channels.fetch().catch(() => guild.channels.cache);
      let category = freshChannels.find(
        c => c && c.type === ChannelType.GuildCategory && c.name.toLowerCase() === categoryName.toLowerCase()
      );

      if (!category) {
        category = await guild.channels.create({
          name: categoryName,
          type: ChannelType.GuildCategory
        });
      }

      let hubChannel;
      try {
        hubChannel = await guild.channels.create({
          name: hubName,
          type: ChannelType.GuildVoice,
          parent: category ? category.id : null
        });
      } catch (err) {
        try {
          category = await guild.channels.create({
            name: categoryName,
            type: ChannelType.GuildCategory
          });
          hubChannel = await guild.channels.create({
            name: hubName,
            type: ChannelType.GuildVoice,
            parent: category.id
          });
        } catch (retryErr) {
          hubChannel = await guild.channels.create({
            name: hubName,
            type: ChannelType.GuildVoice
          });
        }
      }

      await message.reply({
        embeds: [
          successEmbed(
            'Dynamic Voice Hub Configured',
            `The Join-to-Create VC hub has been initialized in <#${hubChannel.id}> under category **${category.name}**.\n\n` +
            `Whenever a member joins this channel, the bot will automatically instantiate a private dynamic voice lounge and move them inside.`
          )
        ]
      });
    } catch (err) {
      await message.reply({
        embeds: [errorEmbed('VC Hub Deployment Error', err.message)]
      });
    }
  }
};

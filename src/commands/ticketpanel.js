const { PermissionsBitField } = require('discord.js');
const { ticketPanelEmbed, errorEmbed, successEmbed } = require('../utils/embeds');
const { getPanelComponents } = require('../handlers/ticketHandler');

module.exports = {
  name: 'ticketpanel',
  description: 'Deploys the interactive Support Dispatch panel into the current channel',
  execute: async (message, args) => {
    // Check permission (Administrator or Manage Channels)
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels) &&
        !message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply({
        embeds: [errorEmbed('Access Denied', 'You require `Manage Channels` permission to deploy the Support Panel.')]
      });
    }

    try {
      await message.channel.send({
        embeds: [ticketPanelEmbed()],
        components: getPanelComponents()
      });

      // Delete invoking command message if possible
      if (message.deletable) {
        await message.delete().catch(() => {});
      }
    } catch (err) {
      message.reply({
        embeds: [errorEmbed('Deployment Failed', `Could not deploy support panel: ${err.message}`)]
      });
    }
  }
};

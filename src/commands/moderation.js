const { PermissionsBitField } = require('discord.js');
const { successEmbed, errorEmbed, infoEmbed } = require('../utils/embeds');
const logger = require('../utils/logger');

// Simple in-memory warning system (can be expanded)
const warnings = new Map();

module.exports = {
  name: 'moderation',
  description: 'Full moderation protocol suite',
  execute: async (message, args, cmdName) => {
    const guild = message.guild;
    const member = message.member;

    // KICK
    if (cmdName === 'kick') {
      if (!member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
        return message.reply({ embeds: [errorEmbed('Permission Denied', 'You require `Kick Members` permission.')] });
      }
      const target = message.mentions.members.first() || guild.members.cache.get(args[0]);
      if (!target) {
        return message.reply({ embeds: [errorEmbed('Target Required', 'Usage: `?kick @user [reason]`')] });
      }
      if (!target.kickable) {
        return message.reply({ embeds: [errorEmbed('Action Restricted', 'Cannot kick this member (higher role or bot lack permissions).')] });
      }
      const reason = args.slice(1).join(' ') || 'No reason specified by operator.';
      await target.kick(reason);
      logger.system(`User @${target.user.tag} was kicked by @${message.author.tag}. Reason: ${reason}`);
      return message.reply({ embeds: [successEmbed('Member Evicted', `**User:** ${target.user.tag}\n**Reason:** ${reason}`)] });
    }

    // BAN
    if (cmdName === 'ban') {
      if (!member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
        return message.reply({ embeds: [errorEmbed('Permission Denied', 'You require `Ban Members` permission.')] });
      }
      const target = message.mentions.members.first() || guild.members.cache.get(args[0]);
      if (!target) {
        return message.reply({ embeds: [errorEmbed('Target Required', 'Usage: `?ban @user [reason]`')] });
      }
      if (!target.bannable) {
        return message.reply({ embeds: [errorEmbed('Action Restricted', 'Cannot ban this member (higher role or bot lack permissions).')] });
      }
      const reason = args.slice(1).join(' ') || 'No reason specified by operator.';
      await target.ban({ reason });
      logger.system(`User @${target.user.tag} was banned by @${message.author.tag}. Reason: ${reason}`);
      return message.reply({ embeds: [successEmbed('Member Exiled', `**User:** ${target.user.tag}\n**Reason:** ${reason}`)] });
    }

    // TIMEOUT / MUTE
    if (cmdName === 'timeout' || cmdName === 'mute') {
      if (!member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        return message.reply({ embeds: [errorEmbed('Permission Denied', 'You require `Moderate Members` permission.')] });
      }
      const target = message.mentions.members.first() || guild.members.cache.get(args[0]);
      if (!target) {
        return message.reply({ embeds: [errorEmbed('Target Required', 'Usage: `?timeout @user <minutes> [reason]`')] });
      }
      const minutes = parseInt(args[1], 10);
      if (isNaN(minutes) || minutes <= 0) {
        return message.reply({ embeds: [errorEmbed('Invalid Duration', 'Please specify duration in minutes (e.g. `?timeout @user 10 Spamming`)')] });
      }
      const reason = args.slice(2).join(' ') || 'Rule violation.';
      const ms = minutes * 60 * 1000;
      await target.timeout(ms, reason);
      logger.system(`User @${target.user.tag} timed out for ${minutes}m by @${message.author.tag}`);
      return message.reply({
        embeds: [successEmbed('User Silenced', `**Target:** ${target.user.tag}\n**Duration:** ${minutes} minute(s)\n**Reason:** ${reason}`)]
      });
    }

    // UNTIMEOUT
    if (cmdName === 'untimeout' || cmdName === 'unmute') {
      if (!member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        return message.reply({ embeds: [errorEmbed('Permission Denied', 'You require `Moderate Members` permission.')] });
      }
      const target = message.mentions.members.first() || guild.members.cache.get(args[0]);
      if (!target) {
        return message.reply({ embeds: [errorEmbed('Target Required', 'Usage: `?untimeout @user`')] });
      }
      await target.timeout(null);
      return message.reply({ embeds: [successEmbed('Timeout Revoked', `Timeout cleared for ${target.user.tag}.`)] });
    }

    // CLEAR / PURGE
    if (cmdName === 'clear' || cmdName === 'purge') {
      if (!member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        return message.reply({ embeds: [errorEmbed('Permission Denied', 'You require `Manage Messages` permission.')] });
      }
      const amount = parseInt(args[0], 10);
      if (isNaN(amount) || amount < 1 || amount > 100) {
        return message.reply({ embeds: [errorEmbed('Invalid Count', 'Specify a number of messages to purge between 1 and 100.')] });
      }
      try {
        await message.delete().catch(() => {});
        const deleted = await message.channel.bulkDelete(amount, true);
        const confirmation = await message.channel.send({
          embeds: [successEmbed('Purge Complete', `Successfully wiped **${deleted.size}** messages from this sector.`)]
        });
        setTimeout(() => confirmation.delete().catch(() => {}), 4000);
      } catch (e) {
        message.channel.send({ embeds: [errorEmbed('Purge Error', e.message)] });
      }
      return;
    }

    // WARN
    if (cmdName === 'warn') {
      if (!member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        return message.reply({ embeds: [errorEmbed('Permission Denied', 'You require `Moderate Members` permission.')] });
      }
      const target = message.mentions.members.first() || guild.members.cache.get(args[0]);
      if (!target) {
        return message.reply({ embeds: [errorEmbed('Target Required', 'Usage: `?warn @user [reason]`')] });
      }
      const reason = args.slice(1).join(' ') || 'Unspecified infraction.';
      const count = (warnings.get(target.id) || 0) + 1;
      warnings.set(target.id, count);

      logger.system(`Warning issued to @${target.user.tag} (#${count}): ${reason}`);

      // Try DMing user
      target.send({
        embeds: [
          errorEmbed(
            `Infraction Warning Received [${guild.name}]`,
            `You have received an official warning.\n**Reason:** ${reason}\n**Total Warnings:** ${count}`
          )
        ]
      }).catch(() => {});

      return message.reply({
        embeds: [
          successEmbed(
            'Infraction Registered',
            `**User:** ${target.user.tag}\n**Total Warnings:** ${count}\n**Reason:** ${reason}`
          )
        ]
      });
    }

    // LOCK / UNLOCK
    if (cmdName === 'lock') {
      if (!member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
        return message.reply({ embeds: [errorEmbed('Permission Denied', 'You require `Manage Channels` permission.')] });
      }
      await message.channel.permissionOverwrites.edit(guild.roles.everyone, {
        SendMessages: false
      });
      return message.reply({
        embeds: [infoEmbed('Channel Locked', `🔒 Lockdown protocol engaged. Message transmission restricted for @everyone.`)]
      });
    }

    if (cmdName === 'unlock') {
      if (!member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
        return message.reply({ embeds: [errorEmbed('Permission Denied', 'You require `Manage Channels` permission.')] });
      }
      await message.channel.permissionOverwrites.edit(guild.roles.everyone, {
        SendMessages: null
      });
      return message.reply({
        embeds: [successEmbed('Channel Unlocked', `🔓 Lockdown lifted. Regular transmission resumed.`)]
      });
    }
  }
};

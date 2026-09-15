const helpCmd = require('./help');
const inviteCmd = require('./invite');
const ticketpanelCmd = require('./ticketpanel');
const vchubCmd = require('./vchub');
const vcControls = require('./vcControls');
const moderation = require('./moderation');
const utility = require('./utility');

const commands = new Map();

// Register Help & Invite
commands.set('help', helpCmd);
commands.set('invite', inviteCmd);

// Register Ticket & VC Hub
commands.set('ticketpanel', ticketpanelCmd);
commands.set('vchub', vchubCmd);

// Register VC Controls
commands.set('vclock', vcControls);
commands.set('vcunlock', vcControls);
commands.set('vclimit', vcControls);

// Register Moderation Directives
commands.set('kick', moderation);
commands.set('ban', moderation);
commands.set('unban', moderation);
commands.set('timeout', moderation);
commands.set('mute', moderation);
commands.set('untimeout', moderation);
commands.set('unmute', moderation);
commands.set('clear', moderation);
commands.set('purge', moderation);
commands.set('warn', moderation);
commands.set('lock', moderation);
commands.set('unlock', moderation);

// Register Utility & Telemetry
commands.set('ping', utility);
commands.set('botinfo', utility);
commands.set('serverinfo', utility);
commands.set('userinfo', utility);
commands.set('say', utility);
commands.set('announce', utility);
commands.set('setstatus', utility);
commands.set('setdesc', utility);
commands.set('setdescription', utility);

module.exports = {
  commands,
  handleCommand: async (message, prefix) => {
    if (!message.content.startsWith(prefix)) return false;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    const cmd = commands.get(commandName);
    if (!cmd) return false;

    try {
      await cmd.execute(message, args, commandName);
      return true;
    } catch (error) {
      console.error(`Error executing command ${commandName}:`, error);
      message.reply(`⚠️ Directive execution failure: ${error.message}`).catch(() => {});
      return true;
    }
  }
};

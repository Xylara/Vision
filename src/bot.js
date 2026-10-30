import { Client, Collection, GatewayIntentBits, Events, MessageFlags, ActivityType } from 'discord.js';
import config from './config.js';
import logger from './lib/logger.js';
import { describeStorage } from './lib/storage.js';
import { UserError } from './lib/errors.js';
import * as gifCommand from './commands/gif.js';
import { deployCommands } from './deploy-commands.js';

const commands = new Collection([[gifCommand.data.name, gifCommand]]);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (readyClient) => {
  logger.info(`logged in as ${readyClient.user.tag} (${readyClient.user.id})`);
  logger.info(`storage: ${describeStorage()}`);
  logger.info(
    config.gif.zoom > 0
      ? `gif defaults: ${config.gif.maxWidth}px, ${config.gif.frames} frames, ${config.gif.frameDelayMs}ms/frame`
      : `gif defaults: ${config.gif.maxWidth}px, still image (zoom disabled)`,
  );

  readyClient.user.setPresence({
    status: 'online',
    activities: [{ name: '/gif', type: ActivityType.Watching }],
  });

  if (config.discord.autoDeployCommands) {
    try {
      await deployCommands();
    } catch (error) {
      logger.error(`could not register slash commands: ${error.message}`);
      if (error.rawError) logger.error(JSON.stringify(error.rawError));
      logger.error('the bot is running, but /gif may be missing until this is fixed');
    }
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    const isUserError = error instanceof UserError;
    logger[isUserError ? 'warn' : 'error'](
      `/${interaction.commandName} failed: ${error.message}`,
      isUserError ? undefined : error,
    );

    const content = isUserError
      ? `⚠️ ${error.message}`
      : '❌ Something went wrong while building your GIF. Please try again.';

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content, embeds: [], files: [] });
      } else {
        await interaction.reply({ content, flags: MessageFlags.Ephemeral });
      }
    } catch (replyError) {
      logger.debug(`could not send error reply: ${replyError.message}`);
    }
  }
});

client.on(Events.Error, (error) => logger.error(`gateway error: ${error.message}`, error));
client.on(Events.Warn, (message) => logger.warn(`gateway warning: ${message}`));

async function shutdown(signal) {
  logger.info(`${signal} received, shutting down`);
  await client.destroy();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (error) => logger.error('unhandled rejection', error));

client.login(config.discord.token).catch((error) => {
  logger.error(`login failed: ${error.message}`);
  process.exit(1);
});

import { REST, Routes } from 'discord.js';
import { pathToFileURL } from 'node:url';
import config from './config.js';
import logger from './lib/logger.js';
import * as gifCommand from './commands/gif.js';

export const commandData = [gifCommand.data.toJSON()];

export async function deployCommands({ token, clientId, guildId } = config.discord) {
  const rest = new REST({ version: '10' }).setToken(token);
  const route = guildId
    ? Routes.applicationGuildCommands(clientId, guildId)
    : Routes.applicationCommands(clientId);

  const result = await rest.put(route, { body: commandData });
  logger.info(
    `registered ${result.length} slash command(s) ${guildId ? `in guild ${guildId}` : 'globally'}`,
  );
  return result;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  deployCommands()
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error(`failed to register commands: ${error.message}`);
      if (error.rawError) logger.error(JSON.stringify(error.rawError));
      process.exit(1);
    });
}

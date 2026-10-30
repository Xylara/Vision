import {
  SlashCommandBuilder,
  AttachmentBuilder,
  MessageFlags,
  InteractionContextType,
} from 'discord.js';
import config from '../config.js';
import { imageToGifWithinLimit, SUPPORTED_MIME_TYPES, SUPPORTED_EXTENSIONS } from '../lib/convert.js';
import { uploadGif } from '../lib/storage.js';
import { downloadAttachment, formatBytes } from '../lib/download.js';
import { UserError } from '../lib/errors.js';
import logger from '../lib/logger.js';

const cooldowns = new Map();

export const data = new SlashCommandBuilder()
  .setName('gif')
  .setDescription('Turn an image into a GIF and host it on object storage')
  .setContexts(
    InteractionContextType.Guild,
    InteractionContextType.BotDM,
    InteractionContextType.PrivateChannel,
  )
  .addAttachmentOption((option) =>
    option
      .setName('image')
      .setDescription('The image to convert (PNG, JPEG, WebP, GIF, AVIF, TIFF, BMP)')
      .setRequired(true),
  )
  .addIntegerOption((option) =>
    option
      .setName('size')
      .setDescription('Output width in pixels (default from server config)')
      .setMinValue(128)
      .setMaxValue(640)
      .setRequired(false),
  )
  .addBooleanOption((option) =>
    option.setName('private').setDescription('Only you can see the result').setRequired(false),
  );

function checkCooldown(userId) {
  const now = Date.now();
  const until = cooldowns.get(userId) ?? 0;
  if (until > now) return Math.ceil((until - now) / 1000);
  cooldowns.set(userId, now + config.limits.cooldownMs);
  if (cooldowns.size > 5000) {
    for (const [id, expiry] of cooldowns) if (expiry <= now) cooldowns.delete(id);
  }
  return 0;
}

function validateAttachment(attachment) {
  const looksLikeImage =
    SUPPORTED_MIME_TYPES.has(attachment.contentType?.toLowerCase() ?? '') ||
    SUPPORTED_EXTENSIONS.test(attachment.name ?? '');

  if (!looksLikeImage) {
    throw new UserError('That attachment is not a supported image. Try a PNG, JPEG, WebP or GIF.');
  }
}

export async function execute(interaction) {
  const isPrivate = interaction.options.getBoolean('private') ?? false;

  const waiting = checkCooldown(interaction.user.id);
  if (waiting > 0) {
    await interaction.reply({
      content: `⏳ Slow down a little — try again in ${waiting}s.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply(isPrivate ? { flags: MessageFlags.Ephemeral } : {});

  const attachment = interaction.options.getAttachment('image', true);
  validateAttachment(attachment);

  const width = interaction.options.getInteger('size') ?? config.gif.maxWidth;
  const startedAt = Date.now();

  const input = await downloadAttachment(attachment, { maxBytes: config.limits.maxInputBytes });
  logger.info(`/gif by ${interaction.user.id}: ${attachment.name} (${formatBytes(input.length)})`);

  const gif = await imageToGifWithinLimit(input, {
    width,
    maxBytes: config.limits.maxOutputBytes,
  });

  const upload = await uploadGif(gif.buffer, {
    metadata: {
      'discord-user-id': interaction.user.id,
      'discord-guild-id': interaction.guildId ?? 'dm',
      'source-name': attachment.name ?? 'image',
    },
  });

  const fileName = upload.key.split('/').pop();

  // Reply with the image only: no link, no embed, no extra text.
  await interaction.editReply({
    content: null,
    embeds: [],
    files: [new AttachmentBuilder(gif.buffer, { name: fileName, description: 'GIF' })],
  });
  logger.info(`/gif done in ${Date.now() - startedAt}ms -> ${upload.url}`);
}

export default { data, execute };

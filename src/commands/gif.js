import {
  SlashCommandBuilder,
  AttachmentBuilder,
  EmbedBuilder,
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
  .setDescription('Turn an image into an animated GIF and host it on object storage')
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
  .addIntegerOption((option) =>
    option
      .setName('frames')
      .setDescription('Number of animation frames, more = smoother but bigger')
      .setMinValue(4)
      .setMaxValue(48)
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
  const frames = interaction.options.getInteger('frames') ?? config.gif.frames;
  const startedAt = Date.now();

  const input = await downloadAttachment(attachment, { maxBytes: config.limits.maxInputBytes });
  logger.info(`/gif by ${interaction.user.id}: ${attachment.name} (${formatBytes(input.length)})`);

  const gif = await imageToGifWithinLimit(input, {
    width,
    frames,
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
  const attachmentMode = config.limits.replyWithAttachment;
  const sendAsFile = attachmentMode === 'always' || (attachmentMode === 'auto' && !upload.isPublic);
  const link = upload.isPublic ? 'Direct link (permanent)' : 'Temporary link (signed)';
  const requester = interaction.user.globalName ?? interaction.user.username ?? 'someone';

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Your GIF is ready')
    .setDescription(`[${link}](${upload.url})`)
    .addFields(
      { name: 'Dimensions', value: `${gif.width}×${gif.height}`, inline: true },
      { name: 'Frames', value: `${gif.frames}`, inline: true },
      { name: 'Size', value: formatBytes(upload.size), inline: true },
      { name: 'Storage', value: `${upload.provider} · \`${upload.key}\``, inline: false },
    )
    .setFooter({ text: `Requested by ${requester}` })
    .setTimestamp();

  const payload = { embeds: [embed] };

  if (sendAsFile) {
    embed.setImage(`attachment://${fileName}`);
    payload.files = [new AttachmentBuilder(gif.buffer, { name: fileName, description: 'Animated GIF' })];
  } else {
    embed.setImage(upload.url);
  }

  await interaction.editReply(payload);
  logger.info(`/gif done in ${Date.now() - startedAt}ms -> ${upload.url}`);
}

export default { data, execute };

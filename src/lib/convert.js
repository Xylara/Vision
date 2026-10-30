import gifenc from 'gifenc';
import sharp from 'sharp';
import config from '../config.js';
import { UserError } from './errors.js';
import logger from './logger.js';

const { GIFEncoder, quantize, applyPalette } = gifenc;

export const SUPPORTED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/tiff',
  'image/bmp',
  'image/heic',
  'image/heif',
]);

export const SUPPORTED_EXTENSIONS = /\.(png|jpe?g|webp|gif|avif|tiff?|bmp|heic|heif)$/i;

const MAX_ASPECT_RATIO = 3;

async function normalize(input, { maxWidth, background }) {
  let { data, info } = await sharp(input, { failOn: 'none', animated: false })
    .rotate()
    .resize({
      width: maxWidth,
      height: maxWidth,
      fit: 'inside',
      withoutEnlargement: true,
      kernel: 'lanczos3',
    })
    .flatten({ background })
    .png()
    .toBuffer({ resolveWithObject: true });

  const aspect = info.width / info.height;
  if (aspect > MAX_ASPECT_RATIO || aspect < 1 / MAX_ASPECT_RATIO) {
    const targetWidth = aspect > MAX_ASPECT_RATIO ? info.width : Math.round(info.height / MAX_ASPECT_RATIO);
    const targetHeight = aspect > MAX_ASPECT_RATIO ? Math.round(info.width / MAX_ASPECT_RATIO) : info.height;
    ({ data, info } = await sharp(data)
      .resize(Math.max(targetWidth, 1), Math.max(targetHeight, 1), {
        fit: 'contain',
        position: 'center',
        background,
      })
      .png()
      .toBuffer({ resolveWithObject: true }));
  }

  return { png: data, width: info.width, height: info.height };
}

async function renderRaw(png) {
  const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return data;
}

function encodeStill(rgba, width, height) {
  const encoder = GIFEncoder();
  const palette = quantize(rgba, 256, { format: 'rgb565' });
  const indexed = applyPalette(rgba, palette, 'rgb565');

  encoder.writeFrame(indexed, width, height, { palette });
  encoder.finish();

  return Buffer.from(encoder.bytes());
}

export async function imageToGif(input, options = {}) {
  const width = options.width ?? config.gif.maxWidth;
  const background = options.background ?? config.gif.background;

  let normalized;
  try {
    normalized = await normalize(input, { maxWidth: width, background });
  } catch (error) {
    logger.debug(`decode failed: ${error.message}`);
    throw new UserError(
      'That file could not be read as an image. Try a PNG, JPEG, WebP or GIF.',
    );
  }

  const { png, width: w, height: h } = normalized;
  const rgba = await renderRaw(png);
  const buffer = encodeStill(rgba, w, h);

  return { buffer, width: w, height: h, frames: 1 };
}

export async function imageToGifWithinLimit(input, options = {}) {
  const maxBytes = options.maxBytes ?? config.limits.maxOutputBytes;
  const baseWidth = options.width ?? config.gif.maxWidth;
  const attempts = [
    {},
    { width: Math.round(baseWidth * 0.75) },
    { width: Math.round(baseWidth * 0.5) },
    { width: Math.round(baseWidth * 0.35) },
  ];

  for (const overrides of attempts) {
    const result = await imageToGif(input, { ...options, ...overrides });
    if (result.buffer.length <= maxBytes) return result;
    logger.debug(
      `gif is ${(result.buffer.length / 1024 / 1024).toFixed(2)}MB, retrying smaller`,
    );
  }

  throw new UserError('That image produces a GIF that is too large. Try a smaller or simpler image.');
}

export default imageToGif;
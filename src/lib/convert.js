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

function zoomScale(index, frameCount, zoom) {
  const phase = (2 * Math.PI * index) / frameCount;
  return 1 + zoom * (0.5 - 0.5 * Math.cos(phase));
}

async function renderFrame(png, width, height, scale) {
  const scaledWidth = Math.max(width, Math.round(width * scale));
  const scaledHeight = Math.max(height, Math.round(height * scale));

  const { data } = await sharp(png)
    .resize(scaledWidth, scaledHeight, { fit: 'fill', kernel: 'lanczos3' })
    .extract({
      left: Math.floor((scaledWidth - width) / 2),
      top: Math.floor((scaledHeight - height) / 2),
      width,
      height,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return data;
}

function encodeFrames(frames, width, height, delayMs) {
  const encoder = GIFEncoder();
  const palette = quantize(frames[0], 256, { format: 'rgb565' });

  frames.forEach((rgba, index) => {
    const indexed = applyPalette(rgba, palette, 'rgb565');
    encoder.writeFrame(indexed, width, height, {
      palette,
      delay: delayMs,
      repeat: index === 0 ? 0 : undefined,
      dispose: 1,
    });
  });

  encoder.finish();
  return Buffer.from(encoder.bytes());
}

export async function imageToGif(input, options = {}) {
  const width = options.width ?? config.gif.maxWidth;
  const frameCount = options.frames ?? config.gif.frames;
  const delayMs = options.delayMs ?? config.gif.frameDelayMs;
  const zoom = options.zoom ?? config.gif.zoom;
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
  const frames = [];

  for (let index = 0; index < frameCount; index += 1) {
    const scale = zoomScale(index, frameCount, zoom);
    frames.push(await renderFrame(png, w, h, scale));
  }

  const buffer = encodeFrames(frames, w, h, delayMs);

  return { buffer, width: w, height: h, frames: frameCount, delayMs };
}

export async function imageToGifWithinLimit(input, options = {}) {
  const maxBytes = options.maxBytes ?? config.limits.maxOutputBytes;
  const attempts = [
    {},
    { width: Math.round((options.width ?? config.gif.maxWidth) * 0.75) },
    { width: Math.round((options.width ?? config.gif.maxWidth) * 0.5), frames: 12 },
  ];

  let result;
  for (const overrides of attempts) {
    result = await imageToGif(input, { ...options, ...overrides });
    if (result.buffer.length <= maxBytes) return result;
    logger.debug(
      `gif is ${(result.buffer.length / 1024 / 1024).toFixed(2)}MB, retrying smaller`,
    );
  }

  result = await imageToGif(input, { ...options, frames: 1, zoom: 0 });
  if (result.buffer.length > maxBytes) {
    throw new UserError('That image produces a GIF that is too large. Try a smaller or simpler image.');
  }
  return result;
}

export default imageToGif;

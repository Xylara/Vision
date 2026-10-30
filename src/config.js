import 'dotenv/config';
import { z } from 'zod';

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

const envFlag = (defaultValue) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value.trim() === '') return defaultValue;
      return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
    });

const envInt = (defaultValue, min, max) =>
  z.coerce.number().int().min(min).max(max).default(defaultValue);

const optionalUrl = z
  .string()
  .optional()
  .transform((value) => (value && value.trim() !== '' ? value.trim() : undefined))
  .refine((value) => value === undefined || /^https?:\/\/.+/.test(value), {
    message: 'must be a valid http(s) URL',
  });

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value && value.trim() !== '' ? value.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
  DISCORD_CLIENT_ID: z.string().min(1, 'DISCORD_CLIENT_ID is required'),
  DISCORD_GUILD_ID: optionalString,
  AUTO_DEPLOY_COMMANDS: envFlag(true),

  STORAGE_PROVIDER: z.enum(['r2', 'b2', 's3', 'minio']).default('r2'),
  STORAGE_ENDPOINT: optionalUrl,
  STORAGE_REGION: optionalString,
  STORAGE_BUCKET: z.string().min(1, 'STORAGE_BUCKET is required'),
  STORAGE_ACCESS_KEY_ID: z.string().min(1, 'STORAGE_ACCESS_KEY_ID is required'),
  STORAGE_SECRET_ACCESS_KEY: z.string().min(1, 'STORAGE_SECRET_ACCESS_KEY is required'),
  STORAGE_PUBLIC_BASE_URL: optionalUrl,
  STORAGE_KEY_PREFIX: z.string().default('gifs'),
  STORAGE_FORCE_PATH_STYLE: envFlag(false),
  STORAGE_SIGNED_URL_TTL: envInt(604800, 60, 604800),

  CLOUDFLARE_ACCOUNT_ID: optionalString,
  B2_REGION: optionalString,

  GIF_MAX_WIDTH: envInt(480, 64, 1024),
  GIF_FRAMES: envInt(24, 4, 60),
  GIF_FRAME_DELAY_MS: envInt(60, 20, 500),
  GIF_ZOOM: z.coerce.number().min(0).max(0.5).default(0.12),
  GIF_BACKGROUND: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'GIF_BACKGROUND must be a hex color like #ffffff')
      .default('#ffffff'),
  ),

  MAX_INPUT_MB: envInt(12, 1, 100),
  MAX_OUTPUT_MB: envInt(8, 1, 25),
  COOLDOWN_SECONDS: envInt(5, 0, 3600),
  REPLY_WITH_ATTACHMENT: z.enum(['auto', 'always', 'never']).default('auto'),
});

function resolveStorage(env) {
  const provider = env.STORAGE_PROVIDER;
  let endpoint = env.STORAGE_ENDPOINT;
  let region = env.STORAGE_REGION;

  if (provider === 'b2' && !region) region = env.B2_REGION;

  if (!endpoint) {
    if (provider === 'r2') {
      if (!env.CLOUDFLARE_ACCOUNT_ID) {
        throw new ConfigError(
          'STORAGE_ENDPOINT is not set. For Cloudflare R2 either set STORAGE_ENDPOINT ' +
            'or set CLOUDFLARE_ACCOUNT_ID (endpoint becomes https://<account>.r2.cloudflarestorage.com).',
        );
      }
      endpoint = `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`;
    } else if (provider === 'b2') {
      if (!region) {
        throw new ConfigError(
          'For Backblaze B2 set B2_REGION (e.g. us-west-004) so the endpoint can be built, ' +
            'or set STORAGE_ENDPOINT and STORAGE_REGION explicitly.',
        );
      }
      endpoint = `https://s3.${region}.backblazeb2.com`;
    } else {
      throw new ConfigError('STORAGE_ENDPOINT is required for the selected STORAGE_PROVIDER.');
    }
  }

  if (!region) {
    if (provider === 'b2') {
      throw new ConfigError(
        'STORAGE_REGION is required for Backblaze B2 (the region shown in the bucket details, e.g. us-west-004).',
      );
    }
    region = provider === 'r2' ? 'auto' : 'us-east-1';
  }

  return {
    provider,
    endpoint,
    region,
    bucket: env.STORAGE_BUCKET,
    accessKeyId: env.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
    publicBaseUrl: env.STORAGE_PUBLIC_BASE_URL?.replace(/\/+$/, ''),
    keyPrefix: env.STORAGE_KEY_PREFIX.replace(/^\/+|\/+$/g, ''),
    forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
    signedUrlTtl: env.STORAGE_SIGNED_URL_TTL,
  };
}

function loadConfig() {
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => {
      const key = issue.path.join('.') || '(root)';
      return `  - ${key}: ${issue.message}`;
    });
    throw new ConfigError(
      `Invalid environment configuration:\n${lines.join('\n')}\n\n` +
        'Copy .env.example to .env and fill in the missing values.',
    );
  }

  const env = parsed.data;

  return {
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,

    discord: {
      token: env.DISCORD_TOKEN,
      clientId: env.DISCORD_CLIENT_ID,
      guildId: env.DISCORD_GUILD_ID,
      autoDeployCommands: env.AUTO_DEPLOY_COMMANDS,
    },

    storage: resolveStorage(env),

    gif: {
      maxWidth: env.GIF_MAX_WIDTH,
      frames: env.GIF_FRAMES,
      frameDelayMs: env.GIF_FRAME_DELAY_MS,
      zoom: env.GIF_ZOOM,
      background: env.GIF_BACKGROUND,
    },

    limits: {
      maxInputBytes: env.MAX_INPUT_MB * 1024 * 1024,
      maxOutputBytes: env.MAX_OUTPUT_MB * 1024 * 1024,
      cooldownMs: env.COOLDOWN_SECONDS * 1000,
      replyWithAttachment: env.REPLY_WITH_ATTACHMENT,
    },
  };
}

export const config = loadConfig();
export default config;

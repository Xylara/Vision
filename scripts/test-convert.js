process.env.DISCORD_TOKEN ??= 'test-token';
process.env.DISCORD_CLIENT_ID ??= 'test-client-id';
process.env.STORAGE_BUCKET ??= 'test-bucket';
process.env.STORAGE_ACCESS_KEY_ID ??= 'test-key';
process.env.STORAGE_SECRET_ACCESS_KEY ??= 'test-secret';
process.env.CLOUDFLARE_ACCOUNT_ID ??= 'test-account';

const { writeFile, mkdir } = await import('node:fs/promises');
const sharp = (await import('sharp')).default;
const { imageToGifWithinLimit } = await import('../src/lib/convert.js');

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#5865f2"/>
      <stop offset="100%" stop-color="#eb459e"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="800" fill="url(#g)"/>
  <circle cx="300" cy="400" r="180" fill="#ffffff" fill-opacity="0.85"/>
  <circle cx="900" cy="300" r="120" fill="#000000" fill-opacity="0.35"/>
  <rect x="700" y="520" width="360" height="160" rx="24" fill="#57f287" fill-opacity="0.9"/>
</svg>`;

const input = await sharp(Buffer.from(svg)).png().toBuffer();
console.log(`input: ${(input.length / 1024).toFixed(1)} KB`);

const started = Date.now();
const result = await imageToGifWithinLimit(input, { maxBytes: 8 * 1024 * 1024 });
const elapsed = Date.now() - started;

await mkdir('/tmp/opencode', { recursive: true });
const out = '/tmp/opencode/test-output.gif';
await writeFile(out, result.buffer);

const meta = await sharp(result.buffer, { animated: true }).metadata();

console.log(`output: ${out}`);
console.log(`  size:       ${(result.buffer.length / 1024).toFixed(1)} KB`);
console.log(`  dimensions: ${result.width}x${result.height}`);
console.log(`  frames:     ${meta.pages ?? result.frames}`);
console.log(`  delay:      ${meta.delay?.[0] ?? '?'}ms`);
console.log(`  loop:       ${meta.loop ?? '?'}`);
console.log(`  took:       ${elapsed}ms`);

import { UserError } from './errors.js';

export async function downloadAttachment(attachment, { maxBytes, timeoutMs = 20000 }) {
  if (attachment.size && attachment.size > maxBytes) {
    throw new UserError(
      `That file is ${formatBytes(attachment.size)}. The limit is ${formatBytes(maxBytes)}.`,
    );
  }

  let response;
  try {
    response = await fetch(attachment.url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new UserError('Timed out while downloading the attachment.');
    }
    throw new UserError('Could not download the attachment from Discord.');
  }

  if (!response.ok) {
    throw new UserError(`Could not download the attachment (HTTP ${response.status}).`);
  }

  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared && declared > maxBytes) {
    throw new UserError(`That file is larger than the ${formatBytes(maxBytes)} limit.`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) {
    throw new UserError(`That file is larger than the ${formatBytes(maxBytes)} limit.`);
  }
  return buffer;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default downloadAttachment;

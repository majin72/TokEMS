import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const port = Number(process.env.NOTIFICATION_SINK_PORT ?? 4080);
const expectedToken = process.env.NOTIFICATION_SINK_TOKEN;
const maximumBodyBytes = 2 * 1024 * 1024;
const acceptedNotifications = new Map();

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBodyBytes) throw new Error('PAYLOAD_TOO_LARGE');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (request.method === 'GET' && url.pathname === '/health') {
    sendJson(response, 200, { status: 'ok', service: 'local-notification-sink' });
    return;
  }

  if (request.method === 'GET' && url.pathname.startsWith('/notifications/')) {
    if (expectedToken && request.headers.authorization !== `Bearer ${expectedToken}`) {
      sendJson(response, 401, { error: 'UNAUTHORIZED' });
      return;
    }
    const id = decodeURIComponent(url.pathname.slice('/notifications/'.length));
    const payload = acceptedNotifications.get(id);
    sendJson(response, payload ? 200 : 404, payload ?? { error: 'NOT_FOUND' });
    return;
  }

  if (request.method !== 'POST' || url.pathname !== '/notifications') {
    sendJson(response, 404, { error: 'NOT_FOUND' });
    return;
  }

  if (expectedToken && request.headers.authorization !== `Bearer ${expectedToken}`) {
    sendJson(response, 401, { error: 'UNAUTHORIZED' });
    return;
  }

  try {
    const payload = await readJson(request);
    if (
      !payload ||
      typeof payload !== 'object' ||
      typeof payload.id !== 'string' ||
      typeof payload.channel !== 'string' ||
      typeof payload.recipient !== 'string'
    ) {
      sendJson(response, 400, { error: 'INVALID_NOTIFICATION' });
      return;
    }

    const messageId = `local-${randomUUID()}`;
    acceptedNotifications.set(payload.id, payload);
    if (acceptedNotifications.size > 500) {
      acceptedNotifications.delete(acceptedNotifications.keys().next().value);
    }
    console.info(`[notification-sink] accepted id=${payload.id} channel=${payload.channel}`);
    sendJson(response, 202, { accepted: true, messageId }, { 'X-Message-Id': messageId });
  } catch (error) {
    if (error instanceof Error && error.message === 'PAYLOAD_TOO_LARGE') {
      sendJson(response, 413, { error: 'PAYLOAD_TOO_LARGE' });
      return;
    }
    sendJson(response, 400, { error: 'INVALID_JSON' });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.info(`[notification-sink] ready port=${port}`);
});

function shutdown(signal) {
  console.info(`[notification-sink] stopping signal=${signal}`);
  server.close((error) => {
    if (error) {
      console.error('[notification-sink] shutdown failed', error);
      process.exit(1);
    }
    process.exit(0);
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

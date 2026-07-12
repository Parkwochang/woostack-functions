import { createServer } from 'node:http';

const port = Number(process.env.PORT ?? '8080');
const maxBodyBytes = 1024 * 1024;

const server = createServer(async (request, response) => {
  if (request.url === '/healthz') {
    json(response, 200, { status: 'ok' });
    return;
  }

  try {
    const input = await readJson(request);
    const requestId =
      request.headers['x-request-id'] ?? request.headers['ce-id'] ?? null;

    json(response, 200, {
      message: `Hello, ${input.name ?? 'world'}!`,
      requestId,
      revision: process.env.K_REVISION ?? 'local',
    });
  } catch (error) {
    json(response, 400, {
      error: error instanceof Error ? error.message : 'invalid request',
    });
  }
});

server.listen(port, '0.0.0.0');

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});

async function readJson(request) {
  const chunks = [];
  let length = 0;

  for await (const chunk of request) {
    length += chunk.length;
    if (length > maxBodyBytes) {
      throw new Error('request body exceeds 1 MiB');
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('request body must be a JSON object');
  }
  return value;
}

function json(response, statusCode, body) {
  response.writeHead(statusCode, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

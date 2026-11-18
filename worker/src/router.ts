/**
 * Minimal URL router for Cloudflare Workers.
 * Pattern matching supports named parameters: /rooms/:id
 */

type Handler = (
  request: Request,
  params: Record<string, string>,
  env: import('./types').Env,
) => Promise<Response> | Response;

interface Route {
  method: string;
  pattern: URLPattern;
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];

  private add(method: string, path: string, handler: Handler): this {
    this.routes.push({
      method,
      pattern: new URLPattern({ pathname: path }),
      handler,
    });
    return this;
  }

  get(path: string, handler: Handler): this { return this.add('GET', path, handler); }
  post(path: string, handler: Handler): this { return this.add('POST', path, handler); }
  patch(path: string, handler: Handler): this { return this.add('PATCH', path, handler); }
  put(path: string, handler: Handler): this { return this.add('PUT', path, handler); }
  delete(path: string, handler: Handler): this { return this.add('DELETE', path, handler); }

  async handle(
    request: Request,
    env: import('./types').Env,
  ): Promise<Response> {
    const url = new URL(request.url);

    for (const route of this.routes) {
      if (route.method !== request.method) continue;
      const match = route.pattern.exec({ pathname: url.pathname });
      if (!match) continue;
      const params = (match.pathname.groups ?? {}) as Record<string, string>;
      return route.handler(request, params, env);
    }

    return json({ error: 'Not found' }, 404);
  }
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function notFound(resource = 'Resource'): Response {
  return json({ error: `${resource} not found` }, 404);
}

export function badRequest(message: string): Response {
  return json({ error: message }, 400);
}

export function conflict(message: string): Response {
  return json({ error: message }, 409);
}

export function unprocessable(message: string): Response {
  return json({ error: message }, 422);
}

/** Safely parses JSON from a request body. Returns null on parse error. */
export async function parseBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

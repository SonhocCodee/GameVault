import type { RouteHandler } from './types.ts';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

export interface RouteMatch {
  handler: RouteHandler;
  params: Record<string, string>;
}

interface RouteEntry {
  method: HttpMethod;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}

export class Router {
  private routes: RouteEntry[] = [];

  add(method: HttpMethod, pathPattern: string, handler: RouteHandler): void {
    const paramNames: string[] = [];
    const normalizedPattern = pathPattern.length > 1 && pathPattern.endsWith('/')
      ? pathPattern.slice(0, -1)
      : pathPattern;

    const regexStr = normalizedPattern.replace(/:([a-zA-Z0-9_]+)/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    const pattern = new RegExp(`^${regexStr}$`);
    this.routes.push({
      method: method.toUpperCase() as HttpMethod,
      pattern,
      paramNames,
      handler,
    });
  }

  get(path: string, handler: RouteHandler): void { this.add('GET', path, handler); }
  post(path: string, handler: RouteHandler): void { this.add('POST', path, handler); }
  put(path: string, handler: RouteHandler): void { this.add('PUT', path, handler); }
  delete(path: string, handler: RouteHandler): void { this.add('DELETE', path, handler); }

  match(method: string, pathname: string): RouteMatch | null {
    const upperMethod = method.toUpperCase() as HttpMethod;
    const normalizedPath = pathname.length > 1 && pathname.endsWith('/')
      ? pathname.slice(0, -1)
      : pathname;

    for (const route of this.routes) {
      if (route.method !== upperMethod) continue;
      const match = normalizedPath.match(route.pattern);
      if (match) {
        const params: Record<string, string> = {};
        route.paramNames.forEach((name, i) => {
          params[name] = decodeURIComponent(match[i + 1]);
        });
        return { handler: route.handler, params };
      }
    }
    return null;
  }
}

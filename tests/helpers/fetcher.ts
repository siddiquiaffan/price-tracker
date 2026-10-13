import {
  type FetchRequest,
  type Fetcher,
  type FetchResponse,
} from '../../src/core/ports/fetcher.js';

export interface ScriptedResponse {
  status: number;
  headers?: Record<string, string>;
  body?: string;
}

/**
 * A fetcher whose responses are scripted per URL. Records every request so
 * tests can assert on what was actually fetched (and through which provider).
 */
export class FakeFetcher implements Fetcher {
  requests: FetchRequest[] = [];
  private readonly responses = new Map<string, ScriptedResponse>();
  defaultResponse: ScriptedResponse = { status: 200, headers: {}, body: '' };
  /** Called exactly once per request body; overrides the URL map. */
  handler: ((request: FetchRequest) => ScriptedResponse | Promise<ScriptedResponse>) | null = null;

  when(url: string, response: ScriptedResponse): void {
    this.responses.set(url, response);
  }

  async fetch(request: FetchRequest): Promise<FetchResponse> {
    this.requests.push(request);
    let response: ScriptedResponse;
    if (this.handler) {
      response = await this.handler(request);
    } else {
      response = this.responses.get(request.url.toString()) ?? this.defaultResponse;
    }
    return {
      status: response.status,
      headers: response.headers ?? {},
      body: response.body ?? '',
      providerId: 'fake',
    };
  }

  /** Convenience: does not count as a fetch (used to seed URL maps). */
  requestUrls(): string[] {
    return this.requests.map((request) => request.url.toString());
  }
}

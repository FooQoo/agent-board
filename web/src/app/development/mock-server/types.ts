import type { Task } from '../../../shared/api/contracts.ts';
import type { Change, ChangedEvent } from '../../../shared/data/api/contracts.ts';
import type { MockBoard, MockSeed } from './boards.ts';

/** One request, as a transport hands it over. */
export interface MockRequest {
  method: string;
  /** The path and query of the request, such as `/api/projects/x/tasks/1/detail?sections=history`. */
  url: string;
  /** The query of the page that sent the request (`?empty=1` and so on). */
  page?: string;
  /** Request headers with lowercase names. `x-agboard-token` and `x-agboard-language` are read. */
  headers?: Record<string, string | undefined>;
  /** The request body as text. For a multipart form, the text of its `metadata` field: images are not read. */
  body?: string;
}

/** A complete answer. The transport waits `delayMs` before it sends one with a delay. */
export interface MockResponse {
  kind: 'response';
  status: number;
  headers: Record<string, string>;
  /** JSON, NDJSON or SVG text; empty for 204. */
  body: string;
  delayMs?: number;
}

/** The request opens the event stream: the transport sends `ready`, then each `changed` event. */
export interface MockEventStream {
  kind: 'events';
}

export type MockResult = MockResponse | MockEventStream;

export interface MockServer {
  /** The answer to a request, or null when the path is not the mock's (neither `/api/` nor `/__mock/`). */
  handle(request: MockRequest): MockResult | null;
  /** Calls `listener` with every `changed` event from now on. Returns the unsubscribe call. */
  subscribe(listener: (event: ChangedEvent) => void): () => void;
  /** The boards as they are now, by project ID. */
  boards(): Readonly<Record<string, MockBoard>>;
}

export interface MockServerOptions extends MockSeed {
  /** The current time as an ISO string; the clock by default. Tests pass a fixed one. */
  now?: () => string;
}

/** What a route sees of the server: the boards, the clock, and the way to store a change. */
export interface MockContext {
  boards(): Readonly<Record<string, MockBoard>>;
  now(): string;
  /** Stores `next` as the board of `projectId`, one revision on, and reports `changes`. */
  commit(projectId: string, next: Omit<MockBoard, 'revision'>, changes: Change[]): void;
  /** Stores the board with `updated` in place of the cards with the same IDs. */
  replaceTasks(board: MockBoard, updated: Task[], changes: Change[]): void;
}

/** A request with its parts read once for the routes. */
export interface RouteRequest {
  method: string;
  url: URL;
  /** The page query parameters. */
  page: URLSearchParams;
  token: string | undefined;
  /** `en` or `ja` when the page sent its language. */
  language: 'en' | 'ja' | undefined;
  body: string | undefined;
}

/** A group of routes: an answer, or null when none of them matches. */
export type Routes = (context: MockContext, request: RouteRequest) => MockResult | null;

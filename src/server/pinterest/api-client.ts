/**
 * Rate-limited Pinterest v5 API client.
 * All requests go through this module — no raw fetch() elsewhere.
 */

const PINTEREST_API_BASE = "https://api.pinterest.com/v5";

/** Minimum ms between successive calls to the same account */
const THROTTLE_MS = 500;
const lastCallTime = new Map<string, number>();

async function throttle(accountId: string): Promise<void> {
  const last = lastCallTime.get(accountId) ?? 0;
  const wait = THROTTLE_MS - (Date.now() - last);
  if (wait > 0) await new Promise<void>((r) => setTimeout(r, wait));
  lastCallTime.set(accountId, Date.now());
}

async function pinterestFetch<T>(
  path: string,
  accessToken: string,
  accountId: string,
  options: RequestInit = {},
): Promise<T> {
  await throttle(accountId);
  const response = await fetch(`${PINTEREST_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  if (response.status === 401 || response.status === 403) {
    throw new PinterestAuthError(
      `Pinterest authentication failed (${response.status}). Please reconnect this account.`,
    );
  }
  if (response.status === 429) {
    throw new PinterestRateLimitError("Pinterest rate limit reached. Will retry shortly.");
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "(no body)");
    throw new PinterestApiError(
      `Pinterest API error (${response.status}): ${text}`,
      response.status,
    );
  }

  return response.json() as Promise<T>;
}

export class PinterestApiError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = "PinterestApiError";
  }
}

export class PinterestAuthError extends PinterestApiError {
  constructor(message: string) {
    super(message, 401);
    this.name = "PinterestAuthError";
  }
}

export class PinterestRateLimitError extends PinterestApiError {
  constructor(message: string) {
    super(message, 429);
    this.name = "PinterestRateLimitError";
  }
}

export interface PinterestUserProfile {
  account_type: string;
  username: string;
  id: string;
  profile_image?: string;
  website_url?: string;
  display_name?: string;
  about?: string;
}

export async function getUserProfile(
  accessToken: string,
  accountId: string,
): Promise<PinterestUserProfile> {
  return pinterestFetch<PinterestUserProfile>(
    "/user_account",
    accessToken,
    accountId,
  );
}

export interface PinterestBoard {
  id: string;
  name: string;
  description?: string;
  privacy?: string;
  owner?: { username?: string };
}

export interface PinterestBoardsResponse {
  items: PinterestBoard[];
  bookmark?: string;
}

export async function getBoards(
  accessToken: string,
  accountId: string,
): Promise<PinterestBoard[]> {
  const boards: PinterestBoard[] = [];
  let bookmark: string | undefined;

  do {
    const params = new URLSearchParams({ page_size: "100" });
    if (bookmark) params.set("bookmark", bookmark);
    const response = await pinterestFetch<PinterestBoardsResponse>(
      `/boards?${params.toString()}`,
      accessToken,
      accountId,
    );
    boards.push(...response.items);
    bookmark = response.bookmark;
  } while (bookmark);

  return boards;
}

export interface CreatePinInput {
  boardId: string;
  title: string;
  description: string;
  link?: string;
  imageUrl: string;
}

export interface PinterestPin {
  id: string;
  link?: string;
}

export async function createPin(
  accessToken: string,
  accountId: string,
  input: CreatePinInput,
): Promise<PinterestPin> {
  const body = {
    board_id: input.boardId,
    title: input.title,
    description: input.description,
    link: input.link ?? undefined,
    media_source: {
      source_type: "image_url",
      url: input.imageUrl,
    },
  };

  return pinterestFetch<PinterestPin>("/pins", accessToken, accountId, {
    method: "POST",
    body: JSON.stringify(body),
  });
}


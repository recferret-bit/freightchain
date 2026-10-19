export interface IssueChallengeInput {
  /** Optional: if omitted, challenge is keyed by `nonce:${nonce}` for 1-click SIWS */
  wallet?: string;
  domain: string;
  origin: string; // uri
  nonce: string;
  now: Date;
  ttlMs: number;
  /** the line the wallet shows as what this signature is for (default: the rider sign-in) */
  statement?: string;
  version?: string;
  chainId?: string;
}

export interface SiwsMessageInput {
  domain: string;
  address?: string;
  statement?: string;
  uri?: string;
  version?: string;
  chainId?: string;
  nonce: string;
  issuedAt: string;
  expirationTime?: string;
  notBefore?: string;
  requestId?: string;
  resources?: readonly string[];
}

export interface ParsedSiwsMessage {
  domain: string;
  address: string;
  statement?: string;
  uri?: string;
  version?: string;
  chainId?: string;
  nonce: string;
  issuedAt?: string;
  expirationTime?: string;
  notBefore?: string;
  requestId?: string;
  resources?: string[];
}

/** Formats a Sign-In-With-Solana canonical message matching @solana/wallet-standard-util byte-for-byte. */
export function formatSignInMessage(input: SiwsMessageInput): string {
  let message = `${input.domain} wants you to sign in with your Solana account:\n`;
  message += `${input.address ?? ''}`;

  if (input.statement) {
    message += `\n\n${input.statement}`;
  }

  const fields: string[] = [];
  if (input.uri) fields.push(`URI: ${input.uri}`);
  if (input.version) fields.push(`Version: ${input.version}`);
  if (input.chainId) fields.push(`Chain ID: ${input.chainId}`);
  if (input.nonce) fields.push(`Nonce: ${input.nonce}`);
  if (input.issuedAt) fields.push(`Issued At: ${input.issuedAt}`);
  if (input.expirationTime) fields.push(`Expiration Time: ${input.expirationTime}`);
  if (input.notBefore) fields.push(`Not Before: ${input.notBefore}`);
  if (input.requestId) fields.push(`Request ID: ${input.requestId}`);
  if (input.resources && input.resources.length > 0) {
    fields.push('Resources:');
    for (const resource of input.resources) {
      fields.push(`- ${resource}`);
    }
  }
  if (fields.length > 0) {
    message += `\n\n${fields.join('\n')}`;
  }

  return message;
}

/** Pure TypeScript parser for canonical SIWS and legacy challenge messages without external dependencies. */
export function parseSignInMessage(raw: string): ParsedSiwsMessage | null {
  if (!raw || typeof raw !== 'string') return null;
  const message = raw.replace(/\r\n/g, '\n');   // CRLF parses like LF (the signature is still checked over the exact bytes signed)

  const headerMatch = /^([^\r\n]+)\s+wants you to sign in with your Solana account:\r?\n([^\r\n]+)/.exec(message);
  if (!headerMatch) return null;

  const domain = headerMatch[1].trim();
  const address = headerMatch[2].trim();
  const rest = message.slice(headerMatch[0].length);

  let statement: string | undefined;
  let fieldsBlock = rest;

  const doubleNewlineIdx = rest.indexOf('\n\n');
  if (doubleNewlineIdx !== -1) {
    const afterFirst = rest.slice(doubleNewlineIdx + 2);
    if (/^(URI|Version|Chain ID|Nonce|Issued At|Expiration Time|Not Before|Request ID|Resources):/.test(afterFirst)) {
      fieldsBlock = afterFirst;
    } else {
      const nextDouble = afterFirst.indexOf('\n\n');
      if (nextDouble !== -1) {
        statement = afterFirst.slice(0, nextDouble).trim();
        fieldsBlock = afterFirst.slice(nextDouble + 2);
      } else {
        statement = afterFirst.trim();
        fieldsBlock = '';
      }
    }
  }

  const fieldLines = fieldsBlock.split(/\r?\n/);
  let uri: string | undefined;
  let version: string | undefined;
  let chainId: string | undefined;
  let nonce: string | undefined;
  let issuedAt: string | undefined;
  let expirationTime: string | undefined;
  let notBefore: string | undefined;
  let requestId: string | undefined;
  const resources: string[] = [];
  let inResources = false;

  for (const rawLine of fieldLines) {
    const line = rawLine.trimEnd();
    if (inResources) {
      if (line.startsWith('- ')) {
        resources.push(line.slice(2).trim());
        continue;
      } else {
        inResources = false;
      }
    }

    if (line.startsWith('URI: ')) uri = line.slice(5).trim();
    else if (line.startsWith('Version: ')) version = line.slice(9).trim();
    else if (line.startsWith('Chain ID: ')) chainId = line.slice(10).trim();
    else if (line.startsWith('Nonce: ')) nonce = line.slice(7).trim();
    else if (line.startsWith('Issued At: ')) issuedAt = line.slice(11).trim();
    else if (line.startsWith('Expiration Time: ')) expirationTime = line.slice(17).trim();
    else if (line.startsWith('Not Before: ')) notBefore = line.slice(12).trim();
    else if (line.startsWith('Request ID: ')) requestId = line.slice(12).trim();
    else if (line === 'Resources:') inResources = true;
  }

  if (!nonce) return null;

  return {
    domain,
    address,
    statement,
    uri,
    version,
    chainId,
    nonce,
    issuedAt,
    expirationTime,
    notBefore,
    requestId,
    resources: resources.length > 0 ? resources : undefined,
  };
}

/** Parses standard SIWS or legacy message and extracts nonce value */
export function extractNonce(message?: string): string | null {
  if (!message) return null;
  const match = message.match(/\bNonce:\s*([a-zA-Z0-9]+)/i);
  return match ? match[1].trim() : null;
}

/** A Sign-In-With-Solana challenge: the server builds the exact text, the wallet signs it, the server verifies the signature over the STORED text. */
export class AuthChallenge {
  constructor(
    readonly wallet: string, // Primary key: wallet address OR 'nonce:' + nonce
    readonly message: string, // Complete message or message with {{address}} placeholder
    readonly expiresAt: Date,
  ) {}

  static nonceKey(nonce: string): string {
    return `nonce:${nonce}`;
  }

  static isNonceKey(key: string): boolean {
    return key.startsWith('nonce:');
  }

  static issue(input: IssueChallengeInput): AuthChallenge {
    const expiresAt = new Date(input.now.getTime() + input.ttlMs);
    const key = input.wallet ?? AuthChallenge.nonceKey(input.nonce);
    const statement = input.statement ?? 'Sign in to Freight Chain. This request will not trigger a transaction or cost any fees.';
    const address = input.wallet ?? '{{address}}';

    const message = formatSignInMessage({
      domain: input.domain,
      address,
      statement,
      uri: input.origin,
      version: input.version,
      chainId: input.chainId,
      nonce: input.nonce,
      issuedAt: input.now.toISOString(),
      expirationTime: expiresAt.toISOString(),
    });

    return new AuthChallenge(key, message, expiresAt);
  }

  /** Returns the exact canonical message text bound to the provided wallet address. */
  messageFor(wallet: string): string {
    if (this.message.includes('{{address}}')) {
      return this.message.replace('{{address}}', wallet);
    }
    return this.message;
  }

  parse(): ParsedSiwsMessage | null {
    return parseSignInMessage(this.message);
  }

  get nonce(): string | null {
    return this.parse()?.nonce ?? extractNonce(this.message);
  }

  get domain(): string | null {
    return this.parse()?.domain ?? null;
  }

  isExpired(now: Date): boolean {
    return this.expiresAt.getTime() < now.getTime();
  }
}

export interface SignedToken {
  token: string;
  expiresAt: Date;
}

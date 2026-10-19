/** One successful sign-in, kept for the admin page (sessions themselves are signed cookies – there is no session table). */
export interface SignInRecord {
  wallet: string;
  at: Date;
  ip: string | null;
  userAgent: string | null;
}

/** Where the request came from – passed from the HTTP edge to the sign-in command. */
export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
}

export const USER_AGENT_MAX_LENGTH = 300;

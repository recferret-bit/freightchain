export interface XProfile {
  userId: string;
  handle: string;
  createdAt: Date;
  followers: number;
  followsOfficial: boolean;
}

export interface XPost {
  userId: string;
  text: string;
}

/** X account facts. Implementations must not call twitterapi.io from this process. */
export abstract class XAccountPort {
  abstract lookup(handle: string): Promise<XProfile | null>;
  abstract quote(postId: string): Promise<XPost | null>;
}

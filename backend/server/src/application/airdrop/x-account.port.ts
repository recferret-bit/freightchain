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

/** Read-only X account facts; tests inject deterministic responses. */
export abstract class XAccountPort {
  abstract lookup(handle: string): Promise<XProfile | null>;
  abstract quote(postId: string): Promise<XPost | null>;
}

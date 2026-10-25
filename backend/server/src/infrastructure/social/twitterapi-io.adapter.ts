import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { XAccountPort, type XPost, type XProfile } from '../../application/airdrop/x-account.port.js';
import { X_OFFICIAL } from '../../application/airdrop/airdrop-rules.js';
import { ServiceUnavailableError } from '../../domain/shared/errors.js';
import { EnvService } from '../config/env.service.js';
import { socialJson } from './social-fetch.js';

const id = z.string().regex(/^\d+$/);
const profileSchema = z.object({ status: z.literal('success'), data: z.object({
  id, userName: z.string().min(1), createdAt: z.string(), followers: z.number().int().nonnegative(),
}).nullable() });
const followSchema = z.object({ status: z.literal('success'), data: z.object({ following: z.boolean() }) });
const postsSchema = z.object({ status: z.literal('success'), tweets: z.array(z.object({ id, text: z.string(), author: z.object({ id }) })) });
const unavailable = () => new ServiceUnavailableError('X verification provider returned invalid data', 'x_verifier_unavailable');

@Injectable()
export class TwitterApiIoAdapter extends XAccountPort {
  constructor(private readonly env: EnvService) { super(); }

  async lookup(handle: string): Promise<XProfile | null> {
    const result = profileSchema.safeParse(await this.get('/twitter/user/info', { userName: handle }));
    if (!result.success) throw unavailable();
    const p = result.data.data;
    if (!p) return null;
    const createdAt = new Date(p.createdAt);
    if (!Number.isFinite(createdAt.getTime()) || p.userName.toLowerCase() !== handle.toLowerCase()) throw unavailable();
    const follow = followSchema.safeParse(await this.get('/twitter/user/check_follow_relationship', { source_user_name: p.userName, target_user_name: X_OFFICIAL }));
    if (!follow.success) throw unavailable();
    return { userId: p.id, handle: p.userName, createdAt, followers: p.followers, followsOfficial: follow.data.data.following };
  }

  async quote(postId: string): Promise<XPost | null> {
    const result = postsSchema.safeParse(await this.get('/twitter/tweets', { tweet_ids: postId }));
    if (!result.success) throw unavailable();
    const post = result.data.tweets.find(p => p.id === postId);
    return post ? { userId: post.author.id, text: post.text } : null;
  }

  private get(path: string, params: Record<string, string>): Promise<unknown> {
    const key = this.env.twitterApiIoKey;
    if (!key) return Promise.reject(new ServiceUnavailableError('X verification is not configured', 'x_verifier_unconfigured'));
    return socialJson(`https://api.twitterapi.io${path}?${new URLSearchParams(params)}`, { headers: { 'X-API-Key': key } }, 'x_verifier_unavailable');
  }
}

/** The replays history page: ended rides older than the `before` cursor, optionally one wallet's or one outcome. */
export class GetReplaysQuery {
  constructor(
    public readonly before: { endedAt: Date; seq: bigint } | null,
    public readonly limit: number,
    public readonly wallet: string | null,
    public readonly status: 'completed' | 'abandoned' | 'failed' | null,
    /** the session, when one was sent: that driver still sees their own pool replay before payout */
    public readonly viewer: string | null = null,
  ) {}
}

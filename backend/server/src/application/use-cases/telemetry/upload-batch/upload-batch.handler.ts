import { Logger, Optional } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { roadPlanFor } from '../../../../domain/road/road-plan.js';
import { RideStatus } from '../../../../domain/rides/ride-status.js';
import type { Ride } from '../../../../domain/rides/ride.entity.js';
import { RideBatch, type BatchBody } from '../../../../domain/telemetry/ride-batch.entity.js';
import { batchMacGenesisMessage, batchMacMessage, continueInpAt30Hz, judgeWorldDigest, stepInpAt30Hz } from '../../../../domain/shared/index.js';
import { RECORDING_GRACE_MS } from '../../../../domain/telemetry/telemetry-rules.js';
import type { BatchReceiptDto } from '../../../../domain/telemetry/telemetry.dto.js';
import { BadRequestError, ConflictError, TooManyRequestsError } from '../../../../domain/shared/errors.js';
import { PlayerRepositoryPort } from '../../../ports/players/player.repository.port.js';
import { HasherPort } from '../../../ports/shared/hasher.port.js';
import { ClockPort } from '../../../ports/shared/clock.port.js';
import { TransactionPort } from '../../../ports/shared/transaction.port.js';
import { RideBatchRepositoryPort } from '../../../ports/telemetry/ride-batch.repository.port.js';
import { RideLookupService } from '../../../services/ride-lookup.service.js';
import { VerdictService } from '../../../services/verdict.service.js';
import { assertBatchStreams } from '../../../telemetry/batch-streams.js';
import { assertEnforceBatch } from '../../../telemetry/enforce-batch.js';
import { assessEnforceBatches } from '../../../telemetry/enforce-resim.js';
import { DeflatePort } from '../../../ports/telemetry/deflate.port.js';
import { TelemetryConfigPort } from '../../../ports/telemetry/telemetry-config.port.js';
import { UploadBatchCommand } from './upload-batch.command.js';

/**
 * One recording batch from the game. Taken while the ride runs and for a minute after it ended (the final flush); a seq already stored is a harmless re-send.
 * The batch is stored in ONE transaction under the wallet's player row lock with the ride read inside it – the same lock /end's judgement takes – so the
 * two serialise: either the judgement sees this batch, or this upload sees the ride already ended and re-judges after its commit. No batch is ever left unjudged.
 * Batches are taken IN ORDER: batch n+1 waits (429 – the game retries it) until batch n is stored, decided on the same read that supplies the tail it is
 * measured with – else a hole pass on the cut between them would never be measured (audit M10; the game's queue is strictly ordered anyway).
 */
@CommandHandler(UploadBatchCommand)
export class UploadBatchHandler implements ICommandHandler<UploadBatchCommand, BatchReceiptDto> {
  private readonly logger = new Logger(UploadBatchHandler.name);

  constructor(
    private readonly lookup: RideLookupService,
    private readonly batches: RideBatchRepositoryPort,
    private readonly hasher: HasherPort,
    private readonly verdicts: VerdictService,
    private readonly clock: ClockPort,
    private readonly players: PlayerRepositoryPort,
    private readonly transactions: TransactionPort,
    @Optional() private readonly deflate?: DeflatePort,
    @Optional() private readonly telemetry?: TelemetryConfigPort,
  ) {}

  async execute({ wallet, rideId, body }: UploadBatchCommand): Promise<BatchReceiptDto> {
    const text = RideBatch.canonical(body);
    const serverHash = this.hasher.sha256Hex(text); // outside the lock: hashing ~100 kB is the slow part
    // the batch before, if stored: its tail is measured with this one against the road (the client chooses where batches are cut – a hole pass across
    // the cut must not go unmeasured). Stored batches never change, so it is read outside the lock too.
    const before = body.seq > 0 ? (await this.batches.listFrom(rideId, body.seq - 1, 1)).find((b) => b.rideId === rideId && b.seq === body.seq - 1) : undefined;
    // an EMPTY batch before (the final flush right after a cut – or one a forger put at a pit) must not cut the measured tail: take the one before it
    const tailOf = before && before.body.samples.length === 0 && body.seq > 1 ? (await this.batches.listFrom(rideId, body.seq - 2, 1)).find((b) => b.rideId === rideId && b.seq === body.seq - 2) : before;
    if (before && before.body.samples.length === 0 && body.samples.length === 0) throw new BadRequestError('two empty batches in a row – the game samples every 0.1 s it drives', 'bad_batch');
    const result = this.transactions.run(async (tx) => {
      await this.players.findByWalletForUpdate(wallet, tx);
      const ride = await this.lookup.require(rideId, wallet, tx);
      const now = this.clock.now();
      if (!ride.acceptsRecording(now, RECORDING_GRACE_MS)) throw new ConflictError(`ride is ${ride.status}`);
      const accepted = RideBatch.accept(rideId, body, serverHash, now, ride.recordingAllowance(now), text, await this.batches.totalBytes(rideId, tx), roadPlanFor(ride.seed, ride.trip), tailOf?.body.samples ?? []); // the per-ride byte budget counts what is stored already; the samples are measured against the SERVER's road (the seed's)
      if (body.seq > 0 && !before) throw new TooManyRequestsError(`batch ${body.seq - 1} of this ride is not stored yet – send the batches in order`, 'batch_out_of_order', 2);   // after the refusals above: a batch that can never be taken says so (400)
      if (this.telemetry?.mode() === 'enforce') {
        const inflate = (raw: Buffer): Buffer => {
          if (!this.deflate) throw new BadRequestError('v2.1 streams do not inflate', 'batch-streams-invalid');
          return this.deflate.inflateRaw(raw);
        };
        assertEnforceBatch(this.hasher, ride, body, before, inflate);
        const prior = await this.batches.listByRide(ride.id, tx);
        const assessed = assessEnforceBatches(this.hasher, ride, [...prior.map((batch) => batch.body), body], inflate);
        let stepped = stepInpAt30Hz({}, [], 0);
        for (const window of assessed.windows) {
          const span = window.endTick - window.startTick;
          stepped = window.startTick === 0 ? stepInpAt30Hz(stepped, assessed.steps, span) : continueInpAt30Hz(stepped, assessed.steps, window.startTick, window.endTick);
        }
        const digest = judgeWorldDigest(assessed.points);
        if (digest === 'reject') throw new BadRequestError(`world digest mismatch lasted at least 10 s (v=${stepped.v})`, 'world-digest-mismatch');
      } else this.assertMac(ride, body, text, before);   // v1 batches (no protocol) skip this. protocol 2 is checked, including while TELEMETRY_V21 is off
      if (body.protocol === 2 && body.streams) assertBatchStreams(body.streams, (raw) => {
        if (!this.deflate) throw new BadRequestError('v2.1 streams do not inflate', 'batch-streams-invalid');
        return this.deflate.inflateRaw(raw);
      });
      return { batch: accepted, stored: await this.batches.insert(accepted, tx), ended: !ride.isInStatus(RideStatus.Running) };
    });
    const { batch, stored, ended } = await result.catch((error: unknown) => {
      // a refused batch breaks the ride's chain: say why, so the admin page (logs, filtered by the ride id) can explain the verdict
      if (error instanceof BadRequestError) this.logger.warn({ event: 'batch-refused', msg: `batch ${body.seq} of ride ${rideId} refused: ${error.message}`, rideId, wallet, seq: body.seq, detail: error.message });
      throw error;
    });
    if (stored && ended) {
      await this.verdicts.judge(rideId).catch((error: unknown) => { this.logger.warn(`re-judging ride ${rideId} failed: ${error instanceof Error ? error.message : String(error)}`); });
    }
    return { seq: batch.seq, stored, hashOk: batch.hashOk };
  }

  /** protocol 2 only. A missing mac and a wrong mac are both 400. A v1 body is left alone so the shadow flag can record both. */
  private assertMac(ride: Ride, body: BatchBody, canonical: string, before: RideBatch | undefined): void {
    if (body.protocol !== 2) return;
    if (!body.mac) throw new BadRequestError('a v2.1 batch needs a mac', 'batch-mac-missing');
    const key = ride.sessionKey;
    if (!key) throw new BadRequestError('this ride has no session key', 'batch-mac-invalid');
    const raw = Buffer.from(key, 'base64');
    const prev = body.seq === 0 ? this.hasher.hmacSha256Hex(raw, batchMacGenesisMessage(ride.id)) : before?.body.mac;
    if (!prev) throw new BadRequestError('the previous v2.1 mac is missing', 'batch-mac-invalid');
    const expected = this.hasher.hmacSha256Hex(raw, batchMacMessage(ride.id, body.seq, prev, canonical));
    if (expected !== body.mac) throw new BadRequestError('the batch mac does not match', 'batch-mac-invalid');
  }
}

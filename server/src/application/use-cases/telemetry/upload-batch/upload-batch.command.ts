import type { BatchBody } from '../../../../domain/telemetry/ride-batch.entity.js';

export class UploadBatchCommand {
  constructor(
    public readonly wallet: string,
    public readonly rideId: string,
    public readonly body: BatchBody,
  ) {}
}

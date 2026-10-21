import { Injectable } from '@nestjs/common';
import { XAccountPort, type XPost, type XProfile } from '../../application/airdrop/x-account.port.js';
import { ServiceUnavailableError } from '../../domain/shared/errors.js';

/**
 * Fail closed. This process does not call out to an X HTTP API. Tests inject an `XAccountPort` fake.
 */
@Injectable()
export class TwitterApiIoAdapter extends XAccountPort {
  lookup(_handle: string): Promise<XProfile | null> {
    return Promise.reject(new ServiceUnavailableError('X verification is not configured', 'x_verifier_unconfigured'));
  }

  quote(_postId: string): Promise<XPost | null> {
    return Promise.reject(new ServiceUnavailableError('X verification is not configured', 'x_verifier_unconfigured'));
  }
}

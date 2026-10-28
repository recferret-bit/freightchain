import { Injectable } from '@nestjs/common';
import { SanctionsCheckPort, type SanctionsResult } from '../../application/ports/prize/sanctions-check.port.js';

/** Wallets whose address ends with this are "listed" by the local fake, so a flagged path can be driven by hand without a provider. */
export const LOCAL_SANCTIONED_SUFFIX = 'SNCT';

/** NOT a screening. Deterministic stand-in until the owner connects a real provider: everything is clean except an address ending in `SNCT`. */
@Injectable()
export class LocalSanctionsCheckAdapter extends SanctionsCheckPort {
  async check(wallet: string): Promise<SanctionsResult> {
    return { clean: !wallet.endsWith(LOCAL_SANCTIONED_SUFFIX), ref: 'local-fake-v1' };
  }
}

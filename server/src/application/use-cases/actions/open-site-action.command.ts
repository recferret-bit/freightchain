import type { SiteLinkTarget } from '../../../domain/actions/action-card.js';

/** The shift card's link buttons. A blink client POSTs to them like any action, so they answer an external link, not a page. */
export class OpenSiteActionCommand {
  constructor(readonly to: SiteLinkTarget, readonly account: string) {}
}

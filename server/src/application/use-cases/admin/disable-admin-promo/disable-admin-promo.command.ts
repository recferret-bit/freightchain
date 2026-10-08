/** Stops a promo code from the admin page – signed by the admin's wallet (`AdminIntent` promo_disable). */
export class DisableAdminPromoCommand {
  constructor(
    public readonly admin: string,
    public readonly code: string,
    public readonly requestId: string | null,
    public readonly signature: string,
  ) {}
}

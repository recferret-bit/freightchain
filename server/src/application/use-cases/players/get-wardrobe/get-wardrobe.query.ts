/** What the wallet owns and wears (visuals) – the lobby's wardrobe and the game's loadout. */
export class GetWardrobeQuery {
  constructor(public readonly wallet: string) {}
}

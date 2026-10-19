/* Re-export. The module lives in js/wallet so the model editor (storybook does not serve /site/) uses the same one. */
export { CHAIN, adapt, isSolanaWallet, onWalletsChanged, safeIcon, walletLabel, wallets } from '../js/wallet/standard.js';

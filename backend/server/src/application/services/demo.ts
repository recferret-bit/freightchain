import type { RulesConfig } from '../ports/config/rules-config.port.js';

/** Demo wallets get their PAID shifts shortened (for the video): '*' = everyone. */
export const isDemoWallet = (rules: RulesConfig, wallet: string): boolean => rules.demoWallets.has('*') || rules.demoWallets.has(wallet);
export const demoScaleOf = (rules: RulesConfig): number => rules.demoScale;

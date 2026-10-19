import { z } from 'zod';
import { WALLET_ADDRESS_MESSAGE, isWalletAddress } from '../../../domain/players/wallet-address.js';

export const walletAddressSchema = z.string().refine(isWalletAddress, WALLET_ADDRESS_MESSAGE);

export const rideIdParamsSchema = z.object({ id: z.string().min(1).max(64) });
export type RideIdParams = z.infer<typeof rideIdParamsSchema>;

import { z } from 'zod';
import { walletAddressSchema } from '../../common/dto/common.dto.js';

const signature = z.string().min(1).max(200);
/** Shape only. An unknown key or a value outside 0..100_000 is `bad_setting` from the domain, before a signature is issued or spent. */
const settingKey = z.string().min(1).max(64);
const settingValue = z.number().int();

export const settingChallengeBodySchema = z.object({ action: z.literal('setting_update'), key: settingKey, value: settingValue });
export type SettingChallengeBody = z.infer<typeof settingChallengeBodySchema>;

export const updateSettingBodySchema = z.object({ key: settingKey, value: settingValue, signature });
export type UpdateSettingBody = z.infer<typeof updateSettingBodySchema>;

const delta = z.number().int().min(-100_000).max(100_000).refine((n) => n !== 0);

export const freeRidesChallengeBodySchema = z.object({ action: z.literal('free_rides_adjust'), wallet: walletAddressSchema, delta });
export type FreeRidesChallengeBody = z.infer<typeof freeRidesChallengeBodySchema>;

export const adjustFreeRidesBodySchema = z.object({ wallet: walletAddressSchema, delta, signature });
export type AdjustFreeRidesBody = z.infer<typeof adjustFreeRidesBodySchema>;

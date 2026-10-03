/**
 * The stdio bridge's spectator summaries (`mcp/spectator.mjs`), typed for this service.
 *
 * Imported, not copied: the remote and local tools summarise the public frames with the same
 * code, so `eve_map` cannot say one thing over stdio and another over HTTP.
 */

import * as bridge from '../../../mcp/spectator.mjs';

type Frame = Record<string, unknown>;

export const summarizeLive = bridge.summarizeLive as unknown as (frame: Frame) => Record<string, unknown>;
export const summarizeRundown = bridge.summarizeRundown as unknown as (frame: Frame) => Record<string, unknown>;
export const dossierFor = bridge.dossierFor as unknown as (handle: string, settled: Frame | null, live: Frame | null, origin: string) => Record<string, unknown>;
export const UNTRUSTED_NOTE: string = bridge.UNTRUSTED_NOTE;

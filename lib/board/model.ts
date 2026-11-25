import 'server-only';
import { env } from '@/lib/env';

/** The model a board's agent runs: the one picked for the board, else the app default. */
export const boardModel = (board: { model?: string }) => board.model || env.DEFAULT_MODEL;

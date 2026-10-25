/** The computer's strength, 1 (easy) to 5 (strongest), shared by all games. */
export const LEVELS = [1, 2, 3, 4, 5];
export const DEFAULT_LEVEL = 3;

/** How often a computer player picks a random move instead of its best one. */
export const mistakeChance = (level) => [0.6, 0.35, 0.15, 0.05, 0][level - 1] ?? 0;

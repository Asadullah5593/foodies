import { BankCard } from '../entities/bank-card.entity';

/**
 * BIN lookup: the cashier types the first digits of a customer's card and the
 * system answers whether any configured bank card (and its discount) matches.
 * Pure matching logic, kept separate from the service for unit testing.
 */

/** Digits only, capped at 8 (the longest BIN we store). */
export function normalizeBin(raw: string | number | null | undefined): string {
    return String(raw ?? '')
        .replace(/\D/g, '')
        .slice(0, 8);
}

/**
 * A card matches when either side is a prefix of the other: stored "455670"
 * matches an 8-digit entry "45567012", and stored 8-digit "45567012" still
 * matches a 6-digit entry "455670". Returns the matched prefix, or null.
 */
export function matchedBinPrefix(
    bin: string,
    prefixes: string[] | null | undefined,
): string | null {
    if (!bin) return null;
    for (const raw of prefixes ?? []) {
        const p = normalizeBin(raw);
        if (!p) continue;
        if (bin.startsWith(p) || p.startsWith(bin)) return p;
    }
    return null;
}

/** All cards whose BIN prefixes match the entered digits. */
export function matchCardsByBin(
    bin: string,
    cards: BankCard[],
): Array<{ card: BankCard; matchedPrefix: string }> {
    const out: Array<{ card: BankCard; matchedPrefix: string }> = [];
    for (const card of cards) {
        const matchedPrefix = matchedBinPrefix(bin, card.binPrefixes);
        if (matchedPrefix) out.push({ card, matchedPrefix });
    }
    return out;
}

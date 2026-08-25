/**
 * How many wrong guesses a swap confirmation code tolerates before it is burned.
 *
 * The code is 6 digits and lives 15 minutes. Bcrypt at cost 10 makes each guess
 * cost ~100 ms, which sounds like protection but is not: 15 minutes of modest
 * concurrency is a meaningful fraction of a 10^6 space, and the attacker here is
 * a trade participant who is *supposed* to be submitting against this code. A
 * counter is what turns "expensive to grind" into "impossible to grind".
 *
 * 5 leaves room for genuine mistyping — the code is copied out of an email by
 * hand — while capping an attacker at 5/10^6 per issued code.
 */
export const MAX_CODE_ATTEMPTS = 5

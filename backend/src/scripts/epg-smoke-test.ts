/**
 * Meezan EPG sandbox smoke test — Phase A validation.
 *
 * Exercises the live provider against the bank's UAT endpoint to answer the
 * open questions BEFORE any product code is built on top:
 *   1. Do the credentials + base URL work?
 *   2. Is the amount accepted in paisa, currency 586?
 *   3. Is a HYPHENATED orderNumber (FDS-XXXX-1) accepted, or must we strip it?
 *   4. Does getOrderStatusExtended work by orderId AND by orderNumber?
 *   5. Which response version are we on (does paymentAmountInfo appear)?
 *
 * Reads credentials from the environment (never hardcoded). Run inside the
 * bank's 9am-6pm weekday window:
 *
 *   MEEZAN_EPG_BASE_URL='https://test-securepayment.meezanbank.com:9716/payment/rest/' \
 *   MEEZAN_EPG_USERNAME='ibft_merchant' \
 *   MEEZAN_EPG_PASSWORD='***' \
 *   npm run epg:smoke
 *
 * Optional: pass an amount in rupees as the first arg (default 10).
 */
import { join } from 'path';
import { config as dotenvConfig } from 'dotenv';
import { EpgError } from '../payments-epg/epg.types';
import { MeezanEpgProvider } from '../payments-epg/meezan-epg.provider';

dotenvConfig({ path: join(process.cwd(), '.env') });

const RETURN_URL =
    process.env.MEEZAN_EPG_RETURN_URL ||
    'https://app.foodies-pakistan.com/pay/return';
const AMOUNT_MAJOR = Number(process.argv[2]) || 10;

function required(name: string): string {
    const v = (process.env[name] || '').trim();
    if (!v) {
        console.error(`\n✗ Missing env ${name}. Set it before running.\n`);
        process.exit(1);
    }
    return v;
}

async function step<T>(
    label: string,
    fn: () => Promise<T>,
): Promise<T | undefined> {
    try {
        const out = await fn();
        console.log(`\n✓ ${label}`);
        return out;
    } catch (e) {
        if (e instanceof EpgError) {
            console.log(
                `\n✗ ${label}\n    ${e.code}${
                    e.gatewayErrorCode
                        ? ` (bank errorCode ${e.gatewayErrorCode})`
                        : ''
                }: ${e.message}`,
            );
        } else {
            console.log(`\n✗ ${label}\n    ${(e as Error).message}`);
        }
        return undefined;
    }
}

async function main() {
    const provider = new MeezanEpgProvider({
        baseUrl: required('MEEZAN_EPG_BASE_URL'),
        userName: required('MEEZAN_EPG_USERNAME'),
        password: required('MEEZAN_EPG_PASSWORD'),
        currency: (process.env.MEEZAN_EPG_CURRENCY || '586').trim(),
        timeoutMs: Number(process.env.MEEZAN_EPG_TIMEOUT_MS) || 20_000,
        defaultLanguage: (process.env.MEEZAN_EPG_LANGUAGE || 'en').trim(),
    });

    console.log('=== Meezan EPG sandbox smoke test ===');
    console.log(`base    : ${process.env.MEEZAN_EPG_BASE_URL}`);
    console.log(
        `amount  : PKR ${AMOUNT_MAJOR} (${Math.round(AMOUNT_MAJOR * 100)} paisa)`,
    );
    console.log(`returnUrl: ${RETURN_URL}`);

    const stamp = Date.now();
    const plainRef = `FDSSMOKE${stamp}`; // no hyphen — expected to work
    const hyphenRef = `FDS-SMOKE-${stamp}`; // hyphen — the open question

    // 1. Register with a plain (no-hyphen) orderNumber.
    const plain = await step(
        `register.do with plain orderNumber (${plainRef})`,
        () =>
            provider.registerOrder({
                orderNumber: plainRef,
                amountMajor: AMOUNT_MAJOR,
                returnUrl: RETURN_URL,
                description: 'EPG smoke test (plain)',
            }),
    );
    if (plain) {
        console.log(`    bankOrderId: ${plain.bankOrderId}`);
        console.log(`    formUrl    : ${plain.formUrl}`);
    }

    // 2. Register with a HYPHENATED orderNumber — answers the AN/hyphen question.
    const hyph = await step(
        `register.do with HYPHENATED orderNumber (${hyphenRef})`,
        () =>
            provider.registerOrder({
                orderNumber: hyphenRef,
                amountMajor: AMOUNT_MAJOR,
                returnUrl: RETURN_URL,
                description: 'EPG smoke test (hyphen)',
            }),
    );
    console.log(
        hyph
            ? '    => hyphens ARE accepted in orderNumber; we can send FDS-XXXX-1 as-is.'
            : '    => hyphenated orderNumber FAILED; strip hyphens (send FDSXXXX1).',
    );

    // 3. Status by bankOrderId (from step 1). Expect status 0 (registered, unpaid).
    if (plain) {
        const byId = await step('getOrderStatusExtended.do by orderId', () =>
            provider.getOrderStatus({ bankOrderId: plain.bankOrderId }),
        );
        if (byId) {
            console.log(
                `    orderStatus: ${byId.orderStatus} (0=registered/unpaid)`,
            );
            const hasV03 =
                'paymentAmountInfo' in byId.raw &&
                byId.raw.paymentAmountInfo != null;
            console.log(
                `    version    : ${
                    hasV03
                        ? '03 (paymentAmountInfo present)'
                        : '01/02 (no paymentAmountInfo — ask bank to enable v03)'
                }`,
            );
        }
    }

    // 4. Status by orderNumber — confirms our-reference lookup works.
    await step('getOrderStatusExtended.do by orderNumber', async () => {
        const s = await provider.getOrderStatus({ orderNumber: plainRef });
        console.log(`    orderStatus by orderNumber: ${s.orderStatus}`);
        return s;
    });

    console.log('\n=== done ===\n');
}

main().catch((e) => {
    console.error('\nUnexpected failure:', e);
    process.exit(1);
});

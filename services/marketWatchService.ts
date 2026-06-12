/**
 * marketWatchService.ts — read-only crypto market data + voice alerts.
 *
 * Data source: CoinGecko public API (no key, generous free tier).
 *
 * Deliberately NO trade execution. Echo can quote prices, watch your
 * thresholds and tell you when they trip — the actual order is always
 * placed by the user in their exchange's own app. A voice agent
 * mishearing "buy 0.1" as "buy 1" is an unrecoverable mistake; price
 * info is not.
 *
 * Tools: market_price, market_set_alert, market_list_alerts, market_remove_alert
 * Alert loop: checks every 2 minutes while the app is open; fires
 * 'market:alert' (toast in App.tsx) when a threshold trips.
 */

import type { FunctionDeclaration } from '@google/genai';
import { Type } from '@google/genai';
import { getCached, setCached } from './cryptoService';

const ALERTS_KEY = 'echo_market_alerts';
const CHECK_INTERVAL_MS = 2 * 60 * 1000;
const CG = 'https://api.coingecko.com/api/v3';

// Common ticker → CoinGecko id. Anything else goes through /search.
const SYMBOL_MAP: Record<string, string> = {
    btc: 'bitcoin', eth: 'ethereum', sol: 'solana', bnb: 'binancecoin',
    xrp: 'ripple', ada: 'cardano', doge: 'dogecoin', dot: 'polkadot',
    avax: 'avalanche-2', link: 'chainlink', matic: 'matic-network',
    ltc: 'litecoin', uni: 'uniswap', atom: 'cosmos', near: 'near',
    apt: 'aptos', arb: 'arbitrum', op: 'optimism', sui: 'sui', ton: 'the-open-network',
    hype: 'hyperliquid', usdt: 'tether', usdc: 'usd-coin',
};

export interface MarketAlert {
    id: string;
    symbol: string;        // user-facing, e.g. "BTC"
    coinId: string;        // coingecko id
    direction: 'above' | 'below';
    price: number;         // USD threshold
    createdAt: number;
    triggeredAt?: number;  // set once fired (one-shot)
}

async function resolveCoinId(symbol: string): Promise<string> {
    const s = symbol.toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (SYMBOL_MAP[s]) return SYMBOL_MAP[s];
    const res = await fetch(`${CG}/search?query=${encodeURIComponent(s)}`);
    if (!res.ok) throw new Error(`CoinGecko search failed (${res.status})`);
    const data = await res.json();
    const hit = data.coins?.[0];
    if (!hit) throw new Error(`Unknown coin: ${symbol}`);
    return hit.id;
}

async function fetchPrices(coinIds: string[]): Promise<Record<string, { usd: number; usd_24h_change: number }>> {
    const res = await fetch(`${CG}/simple/price?ids=${coinIds.join(',')}&vs_currencies=usd&include_24hr_change=true`);
    if (!res.ok) throw new Error(`CoinGecko price fetch failed (${res.status}). Possibly rate-limited — try again in a minute.`);
    return res.json();
}

export function getAlerts(): MarketAlert[] {
    return getCached<MarketAlert[]>(ALERTS_KEY, []);
}
function saveAlerts(alerts: MarketAlert[]): void {
    setCached(ALERTS_KEY, alerts);
}

/* ── alert loop ── */
let loopTimer: ReturnType<typeof setInterval> | null = null;

export function startMarketWatchLoop(): () => void {
    if (loopTimer) clearInterval(loopTimer);
    loopTimer = setInterval(checkAlerts, CHECK_INTERVAL_MS);
    return () => { if (loopTimer) clearInterval(loopTimer); loopTimer = null; };
}

async function checkAlerts(): Promise<void> {
    const active = getAlerts().filter(a => !a.triggeredAt);
    if (active.length === 0) return;
    try {
        const ids = [...new Set(active.map(a => a.coinId))];
        const prices = await fetchPrices(ids);
        const all = getAlerts();
        let changed = false;
        for (const alert of all) {
            if (alert.triggeredAt) continue;
            const p = prices[alert.coinId]?.usd;
            if (p === undefined) continue;
            const tripped = alert.direction === 'above' ? p >= alert.price : p <= alert.price;
            if (tripped) {
                alert.triggeredAt = Date.now();
                changed = true;
                window.dispatchEvent(new CustomEvent('market:alert', {
                    detail: { ...alert, currentPrice: p, message: `${alert.symbol.toUpperCase()} is ${alert.direction} $${alert.price.toLocaleString()} — now $${p.toLocaleString()}` },
                }));
            }
        }
        if (changed) saveAlerts(all);
    } catch (e) {
        console.warn('[marketWatch] alert check failed:', e);
    }
}

/* ── Gemini tools ── */

export const MARKET_TOOLS: FunctionDeclaration[] = [
    {
        name: 'market_price',
        description: 'Get current USD price and 24h change for one or more cryptocurrencies (BTC, ETH, SOL, HYPE, …). Read-only market data. You CANNOT place trades — if the user asks to buy/sell, give them the price and remind them to place the order themselves in their exchange app.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                symbols: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Ticker symbols, e.g. ["BTC","ETH"].' },
            },
            required: ['symbols'],
        },
    },
    {
        name: 'market_set_alert',
        description: 'Set a one-shot price alert. Echo notifies the user when the coin crosses the threshold (checked every ~2 min while the app is open).',
        parameters: {
            type: Type.OBJECT,
            properties: {
                symbol: { type: Type.STRING, description: 'Ticker, e.g. "BTC".' },
                direction: { type: Type.STRING, description: '"above" or "below".' },
                price: { type: Type.NUMBER, description: 'USD threshold.' },
            },
            required: ['symbol', 'direction', 'price'],
        },
    },
    {
        name: 'market_list_alerts',
        description: 'List the user\'s active and triggered price alerts.',
        parameters: { type: Type.OBJECT, properties: {} },
    },
    {
        name: 'market_remove_alert',
        description: 'Remove a price alert by symbol (removes all alerts for that symbol).',
        parameters: {
            type: Type.OBJECT,
            properties: { symbol: { type: Type.STRING } },
            required: ['symbol'],
        },
    },
];

export function isMarketTool(name: string): boolean {
    return name.startsWith('market_');
}

export async function executeMarketTool(name: string, args: Record<string, any>): Promise<{ result?: any; error?: string }> {
    try {
        switch (name) {
            case 'market_price': {
                const symbols = (args.symbols || []).map(String);
                if (symbols.length === 0) return { error: 'No symbols given.' };
                const ids = await Promise.all(symbols.map(resolveCoinId));
                const prices = await fetchPrices(ids);
                const result = symbols.map((sym: string, i: number) => {
                    const p = prices[ids[i]];
                    return p
                        ? { symbol: sym.toUpperCase(), usd: p.usd, change24h: `${p.usd_24h_change >= 0 ? '+' : ''}${p.usd_24h_change?.toFixed(2)}%` }
                        : { symbol: sym.toUpperCase(), error: 'no data' };
                });
                return { result };
            }

            case 'market_set_alert': {
                const coinId = await resolveCoinId(String(args.symbol));
                const alert: MarketAlert = {
                    id: crypto.randomUUID(),
                    symbol: String(args.symbol).toUpperCase(),
                    coinId,
                    direction: args.direction === 'below' ? 'below' : 'above',
                    price: Number(args.price),
                    createdAt: Date.now(),
                };
                if (!isFinite(alert.price) || alert.price <= 0) return { error: 'Invalid price threshold.' };
                const alerts = getAlerts();
                alerts.push(alert);
                saveAlerts(alerts);
                return { result: { set: true, note: `Alert set: ${alert.symbol} ${alert.direction} $${alert.price.toLocaleString()}. Checked every 2 minutes while Echo is open.` } };
            }

            case 'market_list_alerts': {
                const alerts = getAlerts();
                return {
                    result: alerts.length
                        ? alerts.map(a => ({ symbol: a.symbol, condition: `${a.direction} $${a.price.toLocaleString()}`, status: a.triggeredAt ? 'triggered' : 'active' }))
                        : { note: 'No alerts set.' },
                };
            }

            case 'market_remove_alert': {
                const sym = String(args.symbol).toUpperCase();
                const alerts = getAlerts();
                const remaining = alerts.filter(a => a.symbol !== sym);
                saveAlerts(remaining);
                return { result: { removed: alerts.length - remaining.length } };
            }

            default:
                return { error: `Unknown market tool: ${name}` };
        }
    } catch (e: any) {
        return { error: e?.message || 'Market tool failed' };
    }
}

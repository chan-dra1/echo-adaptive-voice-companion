/**
 * weather.mjs — keyless weather briefing line for Echo.
 *
 * Location: uses process.env.ECHO_LAT / ECHO_LON if both are set, otherwise
 * geolocates via the keyless ip-api.com service. Forecast comes from the
 * keyless Open-Meteo API. No API keys, no external dependencies, read-only
 * HTTP GET. Every function degrades to null silently on any failure (no
 * network, bad response, parse error) — the briefing just omits the line.
 */

// WMO weather interpretation codes → short human text.
function describeCode(code) {
    if (code === 0) return 'clear';
    if (code === 1) return 'mainly clear';
    if (code === 2) return 'partly cloudy';
    if (code === 3) return 'overcast';
    if (code === 45 || code === 48) return 'fog';
    if (code >= 51 && code <= 57) return 'drizzle';
    if (code >= 61 && code <= 67) return 'rain';
    if (code >= 71 && code <= 77) return 'snow';
    if (code >= 80 && code <= 82) return 'showers';
    if (code === 85 || code === 86) return 'snow showers';
    if (code >= 95 && code <= 99) return 'thunderstorm';
    return 'unknown conditions';
}

async function getJson(url, timeoutMs = 6000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) return null;
        return await res.json();
    } catch { return null; } finally { clearTimeout(t); }
}

async function resolveLocation() {
    const envLat = process.env.ECHO_LAT;
    const envLon = process.env.ECHO_LON;
    if (envLat && envLon) {
        const lat = Number(envLat);
        const lon = Number(envLon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
            return { lat, lon, city: 'your area' };
        }
    }
    const geo = await getJson('http://ip-api.com/json/');
    if (geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lon)) {
        return { lat: geo.lat, lon: geo.lon, city: geo.city || 'your area' };
    }
    return null;
}

/**
 * Raw current weather object for reuse, or null.
 * @returns {Promise<{ tempC: number, desc: string, highC: number, city: string } | null>}
 */
export async function current() {
    const loc = await resolveLocation();
    if (!loc) return null;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
        '&current=temperature_2m,weather_code&daily=temperature_2m_max&timezone=auto';
    const data = await getJson(url);
    const temp = data?.current?.temperature_2m;
    const code = data?.current?.weather_code;
    const high = data?.daily?.temperature_2m_max?.[0];
    if (typeof temp !== 'number' || typeof code !== 'number') return null;
    return {
        tempC: Math.round(temp),
        desc: describeCode(code),
        highC: typeof high === 'number' ? Math.round(high) : null,
        city: loc.city,
    };
}

/**
 * One short spoken weather line, or null.
 * e.g. "Weather in London: 18°C, light rain, high 22°C."
 */
export async function statusLine() {
    const w = await current();
    if (!w) return null;
    const high = w.highC != null ? `, high ${w.highC}°C` : '';
    return `Weather in ${w.city}: ${w.tempC}°C, ${w.desc}${high}.`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    statusLine().then(line => {
        console.log(line ?? '(weather unavailable — degraded gracefully)');
    });
}

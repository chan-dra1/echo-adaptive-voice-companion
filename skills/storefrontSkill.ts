import { FunctionDeclaration, Type } from '@google/genai';
import { Skill } from '../services/agentSkillService';
import { isCoreConnected, coreWriteFile } from '../services/echoCoreSync';

// ── localStorage key ──────────────────────────────────────────────────────────
const STOREFRONT_KEY = 'echo_storefront';

function loadConfig(): Record<string, any> | null {
    try {
        const raw = localStorage.getItem(STOREFRONT_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

// ── Tool declarations ─────────────────────────────────────────────────────────

const saveStorefrontDeclaration: FunctionDeclaration = {
    name: 'save_storefront',
    description: 'Save (or update) the creator storefront configuration — name, bio, links, products, and social handles. Call this whenever the user wants to set up or edit their link-in-bio / digital storefront page.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            name: {
                type: Type.STRING,
                description: 'Creator or brand name displayed at the top of the storefront.',
            },
            bio: {
                type: Type.STRING,
                description: 'Short bio or tagline (1-3 sentences).',
            },
            avatar_url: {
                type: Type.STRING,
                description: 'URL of the avatar/profile image to show in the circular photo.',
            },
            accent_color: {
                type: Type.STRING,
                description: "Hex color used for buttons and gradient accents (e.g. '#8b5cf6'). Defaults to '#8b5cf6'.",
            },
            links: {
                type: Type.ARRAY,
                description: 'Ordered list of link-in-bio buttons.',
                items: {
                    type: Type.OBJECT,
                    properties: {
                        label: { type: Type.STRING, description: 'Button label text.' },
                        url: { type: Type.STRING, description: 'Destination URL.' },
                        emoji: { type: Type.STRING, description: 'Optional emoji prefix (e.g. 🎬).' },
                    },
                },
            },
            products: {
                type: Type.ARRAY,
                description: 'Digital products or offerings to display in the storefront grid.',
                items: {
                    type: Type.OBJECT,
                    properties: {
                        title: { type: Type.STRING, description: 'Product name.' },
                        description: { type: Type.STRING, description: 'Short product description.' },
                        price: { type: Type.STRING, description: "Price string (e.g. '$29' or 'Free')." },
                        url: { type: Type.STRING, description: 'Buy / download URL.' },
                    },
                },
            },
            social: {
                type: Type.OBJECT,
                description: 'Social media handles or profile URLs.',
                properties: {
                    twitter: { type: Type.STRING, description: 'Twitter / X handle or URL.' },
                    instagram: { type: Type.STRING, description: 'Instagram handle or URL.' },
                    youtube: { type: Type.STRING, description: 'YouTube channel URL.' },
                    tiktok: { type: Type.STRING, description: 'TikTok handle or URL.' },
                    discord: { type: Type.STRING, description: 'Discord invite or server URL.' },
                },
            },
        },
        required: ['name', 'bio'],
    },
};

const generateStorefrontHtmlDeclaration: FunctionDeclaration = {
    name: 'generate_storefront_html',
    description: 'Generate a complete, self-contained, beautiful responsive HTML storefront page from the saved configuration. Optionally write it directly to ~/Desktop/storefront.html via Echo Core.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            save_to_desktop: {
                type: Type.BOOLEAN,
                description: 'If true and Echo Core is connected, write the HTML to ~/Desktop/storefront.html automatically.',
            },
        },
    },
};

const previewStorefrontDeclaration: FunctionDeclaration = {
    name: 'preview_storefront',
    description: 'Return a status summary of the currently configured storefront so the agent can tell the user what is set up (name, bio, link count, product count, etc.).',
    parameters: {
        type: Type.OBJECT,
        properties: {},
    },
};

// ── HTML generator ────────────────────────────────────────────────────────────

function buildHtml(cfg: Record<string, any>): string {
    const accent = cfg.accent_color || '#8b5cf6';

    // Derive a slightly darker shade for gradients
    const accentDark = shadeHex(accent, -30);

    const avatarHtml = cfg.avatar_url
        ? `<img src="${esc(cfg.avatar_url)}" alt="avatar" class="avatar" />`
        : '';

    const socialMap: Record<string, string> = {
        twitter: '🐦',
        instagram: '📸',
        youtube: '▶️',
        tiktok: '🎵',
        discord: '💬',
    };

    const social = cfg.social || {};
    const socialHtml = Object.entries(socialMap)
        .filter(([key]) => social[key])
        .map(([key, icon]) => {
            const href = toUrl(social[key], key);
            return `<a href="${esc(href)}" target="_blank" rel="noopener" class="social-icon" aria-label="${key}">${icon}</a>`;
        })
        .join('');

    const links: any[] = cfg.links || [];
    const linksHtml = links
        .map(
            (l) =>
                `<a href="${esc(l.url || '#')}" target="_blank" rel="noopener" class="link-btn">${l.emoji ? `<span class="link-emoji">${esc(l.emoji)}</span>` : ''}<span>${esc(l.label || '')}</span></a>`
        )
        .join('');

    const products: any[] = cfg.products || [];
    const productsHtml = products.length
        ? `<section class="products-section">
        <h2 class="section-title">My Products</h2>
        <div class="products-grid">
          ${products
              .map(
                  (p) => `<div class="product-card">
            <div class="product-body">
              <h3 class="product-title">${esc(p.title || '')}</h3>
              <p class="product-desc">${esc(p.description || '')}</p>
            </div>
            <div class="product-footer">
              <span class="price-badge">${esc(p.price || 'Free')}</span>
              <a href="${esc(p.url || '#')}" target="_blank" rel="noopener" class="buy-btn">Get it →</a>
            </div>
          </div>`
              )
              .join('')}
        </div>
      </section>`
        : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(cfg.name || 'My Storefront')}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --accent: ${accent};
      --accent-dark: ${accentDark};
      --bg-from: #0f0c29;
      --bg-via: #302b63;
      --bg-to: #24243e;
      --card-bg: rgba(255,255,255,0.05);
      --card-border: rgba(255,255,255,0.10);
      --text: #f1f1f1;
      --text-muted: rgba(241,241,241,0.60);
      --radius: 16px;
      --radius-sm: 10px;
    }

    body {
      min-height: 100vh;
      background: linear-gradient(135deg, var(--bg-from) 0%, var(--bg-via) 50%, var(--bg-to) 100%);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 40px 16px 80px;
    }

    .card {
      width: 100%;
      max-width: 480px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 20px;
    }

    /* ── Avatar ── */
    .avatar {
      width: 96px;
      height: 96px;
      border-radius: 50%;
      object-fit: cover;
      border: 3px solid var(--accent);
      box-shadow: 0 0 24px color-mix(in srgb, var(--accent) 50%, transparent);
      margin-bottom: 4px;
    }

    /* ── Name + Bio ── */
    .creator-name {
      font-size: 1.75rem;
      font-weight: 700;
      text-align: center;
      letter-spacing: -0.5px;
      background: linear-gradient(90deg, #fff 0%, var(--accent) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .creator-bio {
      font-size: 0.95rem;
      color: var(--text-muted);
      text-align: center;
      max-width: 380px;
      line-height: 1.55;
    }

    /* ── Social icons ── */
    .social-row {
      display: flex;
      gap: 14px;
      flex-wrap: wrap;
      justify-content: center;
    }

    .social-icon {
      font-size: 1.5rem;
      text-decoration: none;
      transition: transform 0.2s ease, filter 0.2s ease;
      filter: grayscale(20%);
    }
    .social-icon:hover {
      transform: scale(1.25);
      filter: grayscale(0%);
    }

    /* ── Link buttons ── */
    .links-section {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .link-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      width: 100%;
      padding: 15px 24px;
      border-radius: var(--radius);
      background: linear-gradient(135deg, var(--accent) 0%, var(--accent-dark) 100%);
      color: #fff;
      text-decoration: none;
      font-weight: 600;
      font-size: 0.97rem;
      letter-spacing: 0.2px;
      box-shadow: 0 4px 20px color-mix(in srgb, var(--accent) 35%, transparent);
      transition: transform 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease;
    }
    .link-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 28px color-mix(in srgb, var(--accent) 50%, transparent);
      opacity: 0.92;
    }
    .link-btn:active { transform: translateY(0); opacity: 1; }
    .link-emoji { font-size: 1.15rem; }

    /* ── Products ── */
    .products-section { width: 100%; }

    .section-title {
      font-size: 1.05rem;
      font-weight: 700;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 1.2px;
      margin-bottom: 14px;
      text-align: center;
    }

    .products-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 14px;
    }

    .product-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: var(--radius);
      padding: 18px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 14px;
      backdrop-filter: blur(8px);
      transition: transform 0.18s ease, box-shadow 0.18s ease;
    }
    .product-card:hover {
      transform: translateY(-3px);
      box-shadow: 0 10px 30px rgba(0,0,0,0.3);
    }

    .product-title {
      font-size: 0.97rem;
      font-weight: 700;
      margin-bottom: 6px;
      color: #fff;
    }
    .product-desc {
      font-size: 0.85rem;
      color: var(--text-muted);
      line-height: 1.5;
    }
    .product-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .price-badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--accent) 20%, transparent);
      border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
      color: var(--accent);
      font-size: 0.82rem;
      font-weight: 700;
      white-space: nowrap;
    }

    .buy-btn {
      display: inline-block;
      padding: 6px 14px;
      border-radius: var(--radius-sm);
      background: linear-gradient(135deg, var(--accent) 0%, var(--accent-dark) 100%);
      color: #fff;
      text-decoration: none;
      font-size: 0.84rem;
      font-weight: 600;
      transition: opacity 0.15s ease, transform 0.15s ease;
      white-space: nowrap;
    }
    .buy-btn:hover { opacity: 0.85; transform: scale(1.04); }

    /* ── Footer ── */
    .footer {
      margin-top: 24px;
      font-size: 0.78rem;
      color: rgba(255,255,255,0.25);
      letter-spacing: 0.5px;
    }

    @media (max-width: 380px) {
      .creator-name { font-size: 1.4rem; }
      .products-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="card">
    ${avatarHtml}
    <h1 class="creator-name">${esc(cfg.name || '')}</h1>
    <p class="creator-bio">${esc(cfg.bio || '')}</p>
    ${socialHtml ? `<div class="social-row">${socialHtml}</div>` : ''}
    ${linksHtml ? `<div class="links-section">${linksHtml}</div>` : ''}
    ${productsHtml}
    <p class="footer">Powered by Echo ✦</p>
  </div>
</body>
</html>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s: string): string {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function toUrl(value: string, platform: string): string {
    if (/^https?:\/\//.test(value)) return value;
    const bases: Record<string, string> = {
        twitter: 'https://twitter.com/',
        instagram: 'https://instagram.com/',
        youtube: 'https://youtube.com/@',
        tiktok: 'https://tiktok.com/@',
        discord: 'https://discord.gg/',
    };
    const handle = value.replace(/^@/, '');
    return (bases[platform] || 'https://') + handle;
}

/** Lighten (+) or darken (-) a hex color by `amount` (0-255). */
function shadeHex(hex: string, amount: number): string {
    const clean = hex.replace('#', '');
    const num = parseInt(clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean, 16);
    const r = Math.min(255, Math.max(0, (num >> 16) + amount));
    const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amount));
    const b = Math.min(255, Math.max(0, (num & 0xff) + amount));
    return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

// ── Skill definition ──────────────────────────────────────────────────────────

const storefrontSkill: Skill = {
    name: 'storefrontSkill',
    description:
        'Complete link-in-bio + digital product storefront page builder — the Stan.store ($3.57M MRR) category killer built right into Echo. Creates a beautiful, self-contained HTML storefront with avatar, bio, link buttons, product cards, and social icons. One voice command to build your entire creator presence.',
    tools: [saveStorefrontDeclaration, generateStorefrontHtmlDeclaration, previewStorefrontDeclaration],

    execute: async (toolName: string, args: any): Promise<any> => {
        // ── save_storefront ───────────────────────────────────────────────────
        if (toolName === 'save_storefront') {
            const a = (args && typeof args === 'object') ? args : {};
            if (!a.name || !a.bio) return { error: 'name and bio are required.' };
            const cfg: Record<string, any> = {
                name: String(a.name),
                bio: String(a.bio),
                accent_color: a.accent_color ? String(a.accent_color) : '#8b5cf6',
                ...(a.avatar_url && { avatar_url: String(a.avatar_url) }),
                ...(Array.isArray(a.links) && { links: a.links }),
                ...(Array.isArray(a.products) && { products: a.products }),
                ...(a.social && typeof a.social === 'object' && { social: a.social }),
            };
            localStorage.setItem(STOREFRONT_KEY, JSON.stringify(cfg));
            return { saved: true, name: cfg.name };
        }

        // ── generate_storefront_html ──────────────────────────────────────────
        if (toolName === 'generate_storefront_html') {
            const cfg = loadConfig();
            if (!cfg) {
                return {
                    error: 'No storefront configuration found. Call save_storefront first.',
                };
            }

            const html = buildHtml(cfg);
            let saved_to_desktop = false;

            if (args?.save_to_desktop) {
                if (isCoreConnected()) {
                    await coreWriteFile('~/Desktop/storefront.html', html);
                    saved_to_desktop = true;
                } else {
                    // Graceful degradation — return the HTML anyway
                    return {
                        html,
                        saved_to_desktop: false,
                        warning: 'Echo Core is not connected; could not write to desktop. The HTML is returned here — paste it into a .html file manually.',
                        preview_tip: 'Open storefront.html in your browser',
                    };
                }
            }

            return {
                html,
                saved_to_desktop,
                preview_tip: 'Open storefront.html in your browser',
            };
        }

        // ── preview_storefront ────────────────────────────────────────────────
        if (toolName === 'preview_storefront') {
            const cfg = loadConfig();
            if (!cfg) {
                return {
                    configured: false,
                    name: null,
                    bio: null,
                    link_count: 0,
                    product_count: 0,
                    has_avatar: false,
                    accent_color: null,
                };
            }
            return {
                configured: true,
                name: cfg.name || null,
                bio: cfg.bio || null,
                link_count: Array.isArray(cfg.links) ? cfg.links.length : 0,
                product_count: Array.isArray(cfg.products) ? cfg.products.length : 0,
                has_avatar: !!cfg.avatar_url,
                accent_color: cfg.accent_color || '#8b5cf6',
            };
        }

        return { error: `Unknown tool: ${toolName}` };
    },
};

export default storefrontSkill;

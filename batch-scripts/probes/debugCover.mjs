// debugCover.mjs — run against a single book to trace every step
// Usage: node batch-scripts/debugCover.mjs "Greenteeth" "Molly O'Neill"

import {
    readFileSync
} from 'fs';
import {
    dirname,
    join
} from 'path';
import {
    fileURLToPath
} from 'url';

const __dirname = dirname(fileURLToPath(
    import.meta.url));
const [, , title, author] = process.argv;
if (!title) {
    console.error('Usage: node debugCover.mjs "Title" "Author"');
    process.exit(1);
}

const envText = readFileSync(join(__dirname, '..', '..', '.env.local'), 'utf8');
const env = Object.fromEntries(
    envText.split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => {
        const idx = l.indexOf('=');
        return [l.slice(0, idx).trim(), l.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '')];
    })
);
const ANTHROPIC_KEY = env['ANTHROPIC_API_KEY'] || '';

function cleanTitle(t) {
    return t.replace(/\s*\([^)]*\)/g, '').replace(/\s*\[[^\]]*\]/g, '').replace(/\s*\/.*$/, '').trim();
}

function cleanAuthor(a) {
    return (a || '').split(/[,&]|\sand\s/i)[0].trim();
}

async function verifyImage(url) {
    try {
        const res = await fetch(url, {
            method: 'HEAD'
        });
        const ct = res.headers.get('content-type') || '';
        const cl = parseInt(res.headers.get('content-length') || '0', 10);
        const ok = res.ok && ct.startsWith('image/') && !(cl > 0 && cl < 500);
        console.log('    HEAD', res.status, ct, cl + 'b', ok ? '✓' : '✗', url);
        return ok;
    } catch (e) {
        console.log('    HEAD ERROR:', e.message, url);
        return false;
    }
}

async function main() {
    console.log('\nDebugging cover for: "' + title + '" by ' + author);
    console.log('cleanTitle:', cleanTitle(title));
    console.log('cleanAuthor:', cleanAuthor(author));

    // --- Step 1: Open Library search ---
    console.log('\n[1] Open Library search...');
    try {
        const q = 'title=' + encodeURIComponent(cleanTitle(title)) + '&author=' + encodeURIComponent(cleanAuthor(author)) + '&limit=5';
        const res = await fetch('https://openlibrary.org/search.json?' + q);
        console.log('  HTTP', res.status);
        if (res.ok) {
            const data = await res.json();
            const docs = data.docs || [];
            console.log('  docs found:', docs.length);
            for (let i = 0; i < Math.min(docs.length, 5); i++) {
                console.log('  doc', i, '| cover_i:', docs[i].cover_i, '| isbn:', (docs[i].isbn || []).slice(0, 2));
                if (docs[i].cover_i) await verifyImage('https://covers.openlibrary.org/b/id/' + docs[i].cover_i + '-L.jpg');
                if ((docs[i].isbn || []).length) await verifyImage('https://covers.openlibrary.org/b/isbn/' + docs[i].isbn[0] + '-L.jpg');
            }
        }
    } catch (e) {
        console.log('  ERROR:', e.message);
    }

    // --- Step 2: Hachette search ---
    console.log('\n[2] Hachette search...');
    try {
        const t2 = encodeURIComponent(cleanTitle(title));
        const a2 = encodeURIComponent(cleanAuthor(author));
        const url = 'https://www.hachettebookgroup.com/?s=' + t2 + '+' + a2 + '&post_type=title';
        console.log('  GET', url);
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; BookOracleBot/1.0)'
            }
        });
        console.log('  HTTP', res.status);
        if (res.ok) {
            const html = await res.text();
            const isbns = html.match(/\/titles\/[^"']+\/(97[89]\d{10})\//g);
            console.log('  ISBN matches:', isbns);
        }
    } catch (e) {
        console.log('  ERROR:', e.message);
    }

    // --- Step 3: Google Books ---
    console.log('\n[3] Google Books...');
    try {
        const query = encodeURIComponent('intitle:"' + cleanTitle(title) + '" inauthor:"' + cleanAuthor(author) + '"');
        const res = await fetch('https://www.googleapis.com/books/v1/volumes?q=' + query + '&maxResults=5');
        console.log('  HTTP', res.status);
        if (res.ok) {
            const data = await res.json();
            const items = data.items || [];
            console.log('  items found:', items.length);
            for (let i = 0; i < items.length; i++) {
                const info = items[i].volumeInfo || {};
                const ids = (info.industryIdentifiers || []).map((x) => x.identifier);
                const links = info.imageLinks || {};
                console.log('  item', i, '|', info.title, '| isbns:', ids, '| thumbnail:', links.thumbnail ? 'yes' : 'no');
                if (links.thumbnail) await verifyImage(links.thumbnail.replace(/^http:/, 'https:').replace(/&edge=curl/, '').replace(/&zoom=\d/, '&zoom=1'));
            }
        }
    } catch (e) {
        console.log('  ERROR:', e.message);
    }

    // --- Step 4: Known ISBNs direct on OL + Hachette ---
    console.log('\n[4] Trying known ISBNs directly...');
    const knownIsbns = ['9780316584241', '9780316584494'];
    for (const isbn of knownIsbns) {
        await verifyImage('https://covers.openlibrary.org/b/isbn/' + isbn + '-L.jpg');
        const now = new Date();
        for (let y = now.getFullYear(); y >= now.getFullYear() - 2; y--) {
            for (let m = 12; m >= 1; m--) {
                const mm = String(m).padStart(2, '0');
                const found = await verifyImage('https://www.hachettebookgroup.com/wp-content/uploads/' + y + '/' + mm + '/' + isbn + '.jpg');
                if (found) {
                    console.log('  FOUND at', y + '/' + mm);
                    break;
                }
            }
        }
    }

    // --- Step 5: Claude ---
    console.log('\n[5] Claude...');
    if (!ANTHROPIC_KEY) {
        console.log('  No ANTHROPIC_API_KEY, skipping');
        return;
    }
    try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': ANTHROPIC_KEY,
                'anthropic-version': '2023-06-01',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-6',
                max_tokens: 1024,
                system: 'You are a book cover image finder. Use web_search to find the book, then return ONLY the direct image URL. Reply null if not found.',
                tools: [{
                    type: 'web_search_20250305',
                    name: 'web_search'
                }],
                messages: [{
                    role: 'user',
                    content: 'Find cover image URL for "' + title + '" by ' + author
                }],
            }),
        });
        const data = await res.json();
        const blocks = data.content || [];
        console.log('  content blocks:', blocks.map((b) => b.type));
        for (let i = blocks.length - 1; i >= 0; i--) {
            if (blocks[i].type === 'text') {
                console.log('  final text:', blocks[i].text);
                break;
            }
        }
    } catch (e) {
        console.log('  ERROR:', e.message);
    }
}

main();

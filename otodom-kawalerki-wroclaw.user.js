// ==UserScript==
// @name         Otodom – Pobierz 5 ogłoszeń (kawalerki / wynajem / Wrocław)
// @namespace    https://otodom.pl/scripts/kawalerki-wroclaw
// @version      1.1.0
// @description  Pobiera 5 ogłoszeń kawalerki na wynajem we Wrocławiu i zapisuje JSON + HTML do wybranego folderu
// @author       Custom
// @match        https://www.otodom.pl/*
// @grant        GM_addStyle
// @grant        window.onurlchange
// @run-at       document-idle
// ==/UserScript==

(async () => {
    'use strict';

    // ── Konfiguracja ──────────────────────────────────────────────────────────
    const MAX = 5;
    const DB_NAME   = 'OtodomScraperDB';
    const DB_STORE  = 'handles';
    const HANDLE_KEY = 'folder';
    const SEARCH_URL =
        'https://www.otodom.pl/pl/wyniki/wynajem/kawalerka/dolnoslaskie' +
        '/wroclaw/wroclaw/wroclaw?limit=24&ownerTypeSingleSelect=ALL' +
        '&by=DEFAULT&direction=DESC&viewType=listing';

    // ── IndexedDB – zapis i odczyt uchwytu folderu ───────────────────────────
    function openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = e => e.target.result.createObjectStore(DB_STORE);
            req.onsuccess  = e => resolve(e.target.result);
            req.onerror    = e => reject(e.target.error);
        });
    }

    async function saveHandle(handle) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(DB_STORE, 'readwrite');
            tx.objectStore(DB_STORE).put(handle, HANDLE_KEY);
            tx.oncomplete = resolve;
            tx.onerror    = e => reject(e.target.error);
        });
    }

    async function loadHandle() {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(DB_STORE, 'readonly');
            const req = tx.objectStore(DB_STORE).get(HANDLE_KEY);
            req.onsuccess = e => resolve(e.target.result || null);
            req.onerror   = e => reject(e.target.error);
        });
    }

    // Poproś o dostęp do wcześniej wybranego folderu lub wybierz nowy
    async function getFolder() {
        let handle = await loadHandle();

        if (handle) {
            const perm = await handle.queryPermission({ mode: 'readwrite' });
            if (perm === 'granted') return handle;

            const req = await handle.requestPermission({ mode: 'readwrite' });
            if (req === 'granted') return handle;
        }

        // Brak zapisanego lub brak uprawnień → otwórz okno wyboru
        handle = await window.showDirectoryPicker({
            id:        'otodom-wyniki',
            mode:      'readwrite',
            startIn:   'desktop',
        });
        await saveHandle(handle);
        return handle;
    }

    // Zapisz plik bezpośrednio do wybranego folderu
    async function zapiszPlik(folderHandle, nazwaPliku, blob) {
        const fileHandle = await folderHandle.getFileHandle(nazwaPliku, { create: true });
        const writable   = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
    }

    // ── Styl przycisku ────────────────────────────────────────────────────────
    GM_addStyle(`
        #otd-btn {
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 2147483647;
            background: #009051;
            color: #fff;
            border: none;
            border-radius: 10px;
            padding: 13px 22px;
            font: bold 14px/1 system-ui, sans-serif;
            cursor: pointer;
            box-shadow: 0 4px 16px rgba(0,0,0,.35);
            transition: background .2s;
            max-width: 220px;
            text-align: center;
        }
        #otd-btn:hover    { background: #007540; }
        #otd-btn:disabled { background: #888; cursor: default; }
    `);

    // ── Pomocnik: czekaj na element DOM ──────────────────────────────────────
    function waitFor(selector, timeout = 12000) {
        return new Promise((resolve, reject) => {
            const el = document.querySelector(selector);
            if (el) return resolve(el);
            const obs = new MutationObserver(() => {
                const found = document.querySelector(selector);
                if (found) { obs.disconnect(); resolve(found); }
            });
            obs.observe(document.body, { childList: true, subtree: true });
            setTimeout(() => { obs.disconnect(); reject(new Error('Timeout: ' + selector)); }, timeout);
        });
    }

    // ── Ekstrakcja z __NEXT_DATA__ (Next.js) ─────────────────────────────────
    function extractFromNextData() {
        const el = document.getElementById('__NEXT_DATA__');
        if (!el) return null;
        let nd;
        try { nd = JSON.parse(el.textContent); } catch { return null; }

        const paths = [
            nd?.props?.pageProps?.data?.searchAds?.items,
            nd?.props?.pageProps?.initialProps?.data?.searchAds?.items,
            nd?.props?.pageProps?.listings?.items,
            nd?.props?.pageProps?.data?.items,
        ];
        const items = paths.find(p => Array.isArray(p) && p.length > 0);
        if (!items) return null;

        return items.slice(0, MAX).map((item, idx) => {
            const price =
                item.totalPrice?.value
                    ? `${item.totalPrice.value} ${item.totalPrice.currency}`
                    : item.rentPrice?.value
                    ? `${item.rentPrice.value} ${item.rentPrice.currency}`
                    : 'brak danych';

            const addr = [
                item.location?.address?.street?.name,
                item.location?.address?.district?.name,
                item.location?.address?.city?.name,
            ].filter(Boolean).join(', ');

            const zdjecia = (item.images || [])
                .map(img => img.large || img.medium || img.small || '')
                .filter(Boolean);

            return {
                numer:           idx + 1,
                id:              item.id || '',
                tytul:           item.title || '',
                cena:            price,
                cena_za_m2:      item.pricePerSquareMeter?.value
                                     ? `${item.pricePerSquareMeter.value} ${item.pricePerSquareMeter.currency}/m²`
                                     : '',
                powierzchnia:    item.areaInSquareMeters ? `${item.areaInSquareMeters} m²` : '',
                pokoje:          item.roomsNumber || 1,
                adres:           addr,
                dzielnica:       item.location?.address?.district?.name || '',
                url:             item.slug
                                     ? `https://www.otodom.pl/pl/oferta/${item.slug}`
                                     : '',
                zdjecia,
                miniatura:       zdjecia[0] || '',
                wystawione_przez: item.agency?.name || 'Właściciel prywatny',
                data_dodania:    item.dateCreated || item.pushUpDate || '',
            };
        });
    }

    // ── Ekstrakcja z DOM (fallback) ───────────────────────────────────────────
    function extractFromDOM() {
        const ITEM_SEL = [
            'article[data-cy="listing-item"]',
            '[data-testid="listing-item"]',
            'li[data-id]',
        ].join(', ');

        const nodes = [...document.querySelectorAll(ITEM_SEL)].slice(0, MAX);
        if (!nodes.length) return null;

        return nodes.map((node, idx) => {
            const text     = s => node.querySelector(s)?.textContent?.trim() || '';
            const titleEl  = node.querySelector('[data-cy="listing-item-title"] a, h3 a, h2 a');
            const linkEl   = node.querySelector('a[href*="/oferta/"]');
            const imgEl    = node.querySelector('img');

            return {
                numer:           idx + 1,
                id:              node.dataset.id || node.id || '',
                tytul:           titleEl?.textContent?.trim() || text('h3, h2'),
                cena:            text('[data-cy="listing-regular-price"], [class*="price"]'),
                cena_za_m2:      '',
                powierzchnia:    '',
                pokoje:          1,
                adres:           text('[data-cy="listing-item-address"], [class*="address"]'),
                dzielnica:       '',
                url:             linkEl
                                     ? (linkEl.href.startsWith('http')
                                            ? linkEl.href
                                            : 'https://www.otodom.pl' + linkEl.getAttribute('href'))
                                     : '',
                zdjecia:         imgEl?.src ? [imgEl.src] : [],
                miniatura:       imgEl?.src || '',
                wystawione_przez: '',
                data_dodania:    '',
            };
        });
    }

    // ── Buduj JSON ────────────────────────────────────────────────────────────
    function buildJSON(dane) {
        return JSON.stringify({
            data_pobrania: new Date().toISOString(),
            kryteria: { typ: 'kawalerka', transakcja: 'wynajem', miasto: 'Wrocław' },
            liczba_ogloszen: dane.length,
            ogloszenia: dane,
        }, null, 2);
    }

    // ── Buduj HTML ────────────────────────────────────────────────────────────
    function escHtml(s) {
        return String(s || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function buildHTML(dane) {
        const rows = dane.map(o => `
        <div class="card">
            ${o.miniatura ? `<img src="${escHtml(o.miniatura)}" alt="zdjęcie" loading="lazy">` : ''}
            <div class="info">
                <span class="num">#${o.numer}</span>
                <h2><a href="${escHtml(o.url)}" target="_blank">${escHtml(o.tytul)}</a></h2>
                <p class="price">💰 ${escHtml(o.cena)}${o.cena_za_m2 ? ' · ' + escHtml(o.cena_za_m2) : ''}</p>
                ${o.powierzchnia ? `<p>📐 ${escHtml(o.powierzchnia)}</p>` : ''}
                ${o.adres        ? `<p>📍 ${escHtml(o.adres)}</p>`        : ''}
                <p>🏢 ${escHtml(o.wystawione_przez)}</p>
                <a class="btn" href="${escHtml(o.url)}" target="_blank">Zobacz ogłoszenie →</a>
            </div>
        </div>`).join('\n');

        return `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<title>Otodom – kawalerki / wynajem / Wrocław</title>
<style>
  body  { font-family:system-ui,sans-serif; max-width:860px; margin:40px auto; padding:0 16px; background:#f5f5f5; color:#222; }
  h1   { color:#009051; }
  .meta{ color:#666; font-size:.9em; }
  .card{ background:#fff; border-radius:12px; box-shadow:0 2px 10px rgba(0,0,0,.08); margin:24px 0; display:flex; overflow:hidden; }
  .card img{ width:240px; object-fit:cover; flex-shrink:0; }
  .card .info{ padding:20px; flex:1; }
  .num { background:#009051; color:#fff; border-radius:50%; width:26px; height:26px; display:inline-flex; align-items:center; justify-content:center; font-size:.8em; font-weight:bold; margin-bottom:6px; }
  h2   { margin:4px 0 10px; font-size:1.1em; }
  h2 a { color:#222; text-decoration:none; }
  h2 a:hover { color:#009051; }
  .price{ font-size:1.2em; font-weight:bold; color:#009051; }
  .btn { display:inline-block; margin-top:14px; background:#009051; color:#fff; padding:8px 18px; border-radius:8px; text-decoration:none; font-size:.9em; }
  @media(max-width:600px){ .card{flex-direction:column} .card img{width:100%;height:200px} }
</style>
</head>
<body>
<h1>🏠 Otodom – kawalerki na wynajem, Wrocław</h1>
<p class="meta">Pobrano: ${new Date().toLocaleString('pl-PL')} · Ogłoszeń: ${dane.length}</p>
${rows}
</body></html>`;
    }

    // ── Nazwa pliku z datą ────────────────────────────────────────────────────
    function nazwaPliku(ext) {
        const d = new Date().toISOString().slice(0, 10);
        return `otodom_kawalerki_wroclaw_${d}.${ext}`;
    }

    // ── Główna logika ─────────────────────────────────────────────────────────
    async function run(btn) {
        btn.disabled = true;

        const naWynikach =
            location.href.includes('/wyniki/wynajem/kawalerka') &&
            location.href.includes('wroclaw');

        if (!naWynikach) {
            btn.textContent = '🔄 Przechodzę na wyniki…';
            location.href = SEARCH_URL;
            return;
        }

        try {
            // 1. Wybierz / autoryzuj folder docelowy
            btn.textContent = '📂 Wybierz folder…';
            let folder;
            try {
                folder = await getFolder();
            } catch (err) {
                // Użytkownik anulował lub brak API
                if (err.name === 'AbortError') {
                    btn.textContent = '📥 Pobierz 5 ogłoszeń';
                    btn.disabled = false;
                    return;
                }
                throw err;
            }

            // 2. Czekaj na załadowanie ogłoszeń
            btn.textContent = '⏳ Ładuję ogłoszenia…';
            try {
                await waitFor(
                    'article[data-cy="listing-item"], [data-testid="listing-item"], li[data-id]',
                    15000
                );
            } catch { /* brak dopasowania DOM – spróbujemy mimo to */ }

            await new Promise(r => setTimeout(r, 1200));

            // 3. Ekstrahuj dane
            const dane = extractFromNextData() || extractFromDOM();

            if (!dane || dane.length === 0) {
                alert('Nie znaleziono ogłoszeń. Odśwież stronę i spróbuj ponownie.');
                btn.textContent = '📥 Pobierz 5 ogłoszeń';
                btn.disabled = false;
                return;
            }

            // 4. Zapisz pliki bezpośrednio do folderu
            btn.textContent = '💾 Zapisuję pliki…';

            await zapiszPlik(
                folder,
                nazwaPliku('json'),
                new Blob([buildJSON(dane)], { type: 'application/json;charset=utf-8' })
            );

            await zapiszPlik(
                folder,
                nazwaPliku('html'),
                new Blob([buildHTML(dane)], { type: 'text/html;charset=utf-8' })
            );

            btn.textContent = `✅ Zapisano ${dane.length} ogłoszenia!`;
            setTimeout(() => {
                btn.textContent = '📥 Pobierz 5 ogłoszeń';
                btn.disabled = false;
            }, 4000);

        } catch (err) {
            console.error('[OtodomScraper]', err);
            alert('Błąd: ' + err.message);
            btn.textContent = '📥 Pobierz 5 ogłoszeń';
            btn.disabled = false;
        }
    }

    // ── Dodaj przycisk ────────────────────────────────────────────────────────
    function dodajPrzycisk() {
        if (document.getElementById('otd-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'otd-btn';
        btn.textContent = '📥 Pobierz 5 ogłoszeń';
        btn.addEventListener('click', () => run(btn));
        document.body.appendChild(btn);
    }

    if (typeof window.onurlchange !== 'undefined') {
        window.addEventListener('urlchange', dodajPrzycisk);
    }

    dodajPrzycisk();

    // Auto-uruchom jeśli już jesteśmy na stronie wyników
    if (
        location.href.includes('/wyniki/wynajem/kawalerka') &&
        location.href.includes('wroclaw')
    ) {
        const btn = document.getElementById('otd-btn');
        if (btn) setTimeout(() => run(btn), 2500);
    }
})();

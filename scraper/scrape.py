import requests
import json
import re
import os
from datetime import datetime

SEARCH_URL = (
    "https://www.otodom.pl/pl/wyniki/wynajem/kawalerka/dolnoslaskie"
    "/wroclaw/wroclaw/wroclaw?limit=24&ownerTypeSingleSelect=ALL"
    "&by=DEFAULT&direction=DESC&viewType=listing"
)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "pl-PL,pl;q=0.9,en-US;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Cache-Control": "max-age=0",
}

MAX = 10


def extract_listings(html):
    match = re.search(
        r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
        html,
        re.DOTALL,
    )
    if not match:
        raise ValueError("Nie znaleziono __NEXT_DATA__ w stronie")

    nd = json.loads(match.group(1))
    pp = nd.get("props", {}).get("pageProps", {})

    candidates = [
        pp.get("data", {}).get("searchAds", {}).get("items"),
        pp.get("initialProps", {}).get("data", {}).get("searchAds", {}).get("items"),
        pp.get("listings", {}).get("items"),
        pp.get("data", {}).get("items"),
    ]
    items = next((c for c in candidates if isinstance(c, list) and c), None)
    if not items:
        raise ValueError("Nie znaleziono ogłoszeń w __NEXT_DATA__")

    results = []
    for idx, item in enumerate(items[:MAX]):
        tp = item.get("totalPrice") or {}
        rp = item.get("rentPrice") or {}
        if tp.get("value"):
            price = f"{tp['value']} {tp.get('currency', 'PLN')}"
        elif rp.get("value"):
            price = f"{rp['value']} {rp.get('currency', 'PLN')}"
        else:
            price = "brak danych"

        loc = item.get("location", {}).get("address", {})
        addr = ", ".join(
            p
            for p in [
                loc.get("street", {}).get("name"),
                loc.get("district", {}).get("name"),
                loc.get("city", {}).get("name"),
            ]
            if p
        )

        photos = [
            img.get("large") or img.get("medium") or img.get("small", "")
            for img in item.get("images", [])
        ]
        photos = [p for p in photos if p]

        slug = item.get("slug", "")
        url = f"https://www.otodom.pl/pl/oferta/{slug}" if slug else ""

        ppm = item.get("pricePerSquareMeter") or {}
        results.append(
            {
                "numer": idx + 1,
                "id": str(item.get("id", "")),
                "tytul": item.get("title", ""),
                "cena": price,
                "cena_za_m2": (
                    f"{ppm['value']} {ppm.get('currency', 'PLN')}/m²"
                    if ppm.get("value")
                    else ""
                ),
                "powierzchnia": (
                    f"{item['areaInSquareMeters']} m²"
                    if item.get("areaInSquareMeters")
                    else ""
                ),
                "pokoje": item.get("roomsNumber", 1),
                "adres": addr,
                "dzielnica": loc.get("district", {}).get("name", ""),
                "url": url,
                "zdjecia": photos,
                "miniatura": photos[0] if photos else "",
                "wystawione_przez": (
                    (item.get("agency") or {}).get("name") or "Właściciel prywatny"
                ),
                "data_dodania": item.get("dateCreated") or item.get("pushUpDate") or "",
            }
        )

    return results


def main():
    session = requests.Session()
    session.get("https://www.otodom.pl/", headers=HEADERS, timeout=30)

    response = session.get(SEARCH_URL, headers=HEADERS, timeout=30)
    response.raise_for_status()

    listings = extract_listings(response.text)

    output = {
        "data_pobrania": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "kryteria": {"typ": "kawalerka", "transakcja": "wynajem", "miasto": "Wrocław"},
        "liczba_ogloszen": len(listings),
        "ogloszenia": listings,
    }

    os.makedirs("data", exist_ok=True)
    with open("data/listings.json", "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"Zapisano {len(listings)} ogłoszeń do data/listings.json")


if __name__ == "__main__":
    main()

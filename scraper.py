"""
Grand Prix Scraper
Raccoglie il numero di membri per ogni gruppo Facebook e aggiorna data.json.
Eseguire manualmente o schedulare alle 19:00 ogni giorno.
"""

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import time
import re
import json
import os
import datetime
import schedule

# ─── PERCORSI ────────────────────────────────────────────────────────────────
BASE_DIR  = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(BASE_DIR, "data", "data.json")

# ─── GRUPPI (stesso ordine di setup_groups.py) ───────────────────────────────
GROUPS = [
    {"id": "achivieneaprenderlo",  "url": "https://www.facebook.com/groups/1048313410496721"},
    {"id": "teloregaloroma",       "url": "https://www.facebook.com/groups/teloregaloroma"},
    {"id": "teloregaloroma_1782",  "url": "https://www.facebook.com/groups/1782277075337038"},
    {"id": "terzomunicipio",       "url": "https://www.facebook.com/groups/511625936464055"},
    {"id": "ostia",                "url": "https://www.facebook.com/groups/teloregaloaostia2"},
    {"id": "romaprovincia_632",    "url": "https://www.facebook.com/groups/632312010245152"},
    {"id": "romaweekend",          "url": "https://www.facebook.com/groups/870151693714718"},
    {"id": "romalazio",            "url": "https://www.facebook.com/groups/regaloromalazio"},
    {"id": "ottavia",              "url": "https://www.facebook.com/groups/1161334544071536"},
    {"id": "regaliamo",            "url": "https://www.facebook.com/groups/1676552915919346"},
    {"id": "lazio",                "url": "https://www.facebook.com/groups/207795302689686"},
    {"id": "torpigna",             "url": "https://www.facebook.com/groups/teloregaloatorpigna"},
    {"id": "teloregaloaroma",      "url": "https://www.facebook.com/groups/720527735059755"},
    {"id": "nonlobutto",           "url": "https://www.facebook.com/groups/209428462531883"},
    {"id": "regalorisuso",         "url": "https://www.facebook.com/groups/430600883705133"},
    {"id": "romalaziotutto",       "url": "https://www.facebook.com/groups/384263265452457"},
    {"id": "viterbo",              "url": "https://www.facebook.com/groups/452118458297847"},
    {"id": "nettuno",              "url": "https://www.facebook.com/groups/1525223844401654"},
    {"id": "centocelle",           "url": "https://www.facebook.com/groups/281554295535883"},
    {"id": "romaweekend2",         "url": "https://www.facebook.com/groups/756684261060296"},
    {"id": "romaconilcuore",       "url": "https://www.facebook.com/groups/1764324463810891"},
    {"id": "romaprovincia_2997",   "url": "https://www.facebook.com/groups/2997157297257346"},
    {"id": "romanord",             "url": "https://www.facebook.com/groups/1632338883801431"},
    {"id": "trastevere",           "url": "https://www.facebook.com/groups/864133581250528"},
    {"id": "ostia2",               "url": "https://www.facebook.com/groups/791308374766294"},
    {"id": "municipiov",           "url": "https://www.facebook.com/groups/1936436096583782"},
    {"id": "ciampino",             "url": "https://www.facebook.com/groups/230107133820164"},
    {"id": "monterotondo",         "url": "https://www.facebook.com/groups/791135487688782"},
]

# ─── HELPERS ─────────────────────────────────────────────────────────────────
def parse_membri(text):
    """Converte '45.230' o '45,230' o '45230' in intero."""
    cleaned = re.sub(r'[.\s]', '', text.strip())
    cleaned = cleaned.replace(',', '')
    try:
        return int(cleaned)
    except ValueError:
        return None


def scrape():
    print(f"\n[{datetime.datetime.now().strftime('%Y-%m-%d %H:%M')}] Avvio scraping...")

    # ── Apri Chrome con profilo dedicato ─────────────────────────────────────
    options = webdriver.ChromeOptions()
    options.add_argument(r"user-data-dir=C:\SeleniumProfiles\GrandPrix")
    driver = webdriver.Chrome(options=options)
    driver.get("https://www.facebook.com")
    time.sleep(6)

    today   = datetime.date.today().strftime("%Y-%m-%d")
    results = {}

    for g in GROUPS:
        gid  = g["id"]
        gurl = g["url"]
        print(f"  -> {gid}: {gurl}")

        try:
            driver.get(gurl)
            time.sleep(5)

            # Cerca "Membri" nello span/testo della pagina
            # Facebook mostra "X membri" oppure "Membri · X"
            found = False

            # Formato atteso: "Membri: 129.638"
            spans = driver.find_elements(By.XPATH,
                "//*[contains(text(), 'Membri:')]"
            )
            for span in spans:
                txt = span.text.strip()
                m = re.search(r'Membri:\s*([\d.]+)', txt)
                if m:
                    val = parse_membri(m.group(1))
                    if val and val > 0:
                        results[gid] = val
                        print(f"     Trovato: {val} membri")
                        found = True
                        break

            # Strategia 2: scroll + riprova se non trovato
            if not found:
                driver.execute_script("window.scrollBy(0, 600);")
                time.sleep(2)
                spans = driver.find_elements(By.XPATH,
                    "//*[contains(text(), 'Membri:')]"
                )
                for span in spans:
                    txt = span.text.strip()
                    m = re.search(r'Membri:\s*([\d.]+)', txt)
                    if m:
                        val = parse_membri(m.group(1))
                        if val and val > 0:
                            results[gid] = val
                            print(f"     Trovato (scroll): {val} membri")
                            found = True
                            break

            if not found:
                print(f"     ATTENZIONE: numero membri non trovato per {gid}")

        except Exception as e:
            print(f"     ERRORE su {gid}: {e}")
            continue

        time.sleep(2)  # pausa tra un gruppo e l'altro

    driver.quit()
    print("Chrome chiuso.")

    if not results:
        print("Nessun dato raccolto, data.json non aggiornato.")
        return

    # ── Aggiorna data.json ────────────────────────────────────────────────────
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    snapshots = data.get("snapshots", [])

    # Se esiste già uno snapshot di oggi, aggiornalo; altrimenti aggiungilo
    existing = next((s for s in snapshots if s["date"] == today), None)
    if existing:
        existing["data"].update(results)
        print(f"Snapshot del {today} aggiornato.")
    else:
        snapshots.append({"date": today, "data": results})
        print(f"Nuovo snapshot aggiunto per {today}.")

    # Mantieni cronologicamente ordinato
    snapshots.sort(key=lambda s: s["date"])
    data["snapshots"] = snapshots

    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"data.json aggiornato. Gruppi rilevati: {len(results)}/{len(GROUPS)}")
    for gid, val in sorted(results.items(), key=lambda x: -x[1]):
        print(f"  {gid}: {val:,}")


# ─── SCHEDULER ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("Grand Prix Scraper avviato.")
    print("Prossima esecuzione alle 19:00 ogni giorno.")
    print("(Premi Ctrl+C per fermare)\n")

    schedule.every().day.at("19:00").do(scrape)

    # Esegui subito se vuoi testare senza aspettare le 19:00:
    scrape()

    while True:
        schedule.run_pending()
        time.sleep(30)

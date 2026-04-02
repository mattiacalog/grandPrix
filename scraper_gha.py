"""
Grand Prix Scraper — GitHub Actions version
Headless Chrome su Linux, nessun login richiesto
"""

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
import time, re, json, os, datetime

BASE_DIR  = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(BASE_DIR, "data", "data.json")

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

def parse_membri(text):
    cleaned = re.sub(r'[.\s]', '', text.strip()).replace(',', '')
    try:
        return int(cleaned)
    except ValueError:
        return None

def make_driver():
    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-blink-features=AutomationControlled")
    opts.add_argument("--window-size=1280,900")
    opts.add_argument("user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
    opts.add_experimental_option("excludeSwitches", ["enable-automation"])
    return webdriver.Chrome(options=opts)

def accept_cookies(driver):
    driver.get("https://www.facebook.com")
    time.sleep(4)
    try:
        btn = driver.find_element(By.XPATH,
            "//button[contains(., 'Consenti tutti i cookie') or contains(., 'Allow all cookies') or contains(., 'Accept all')]")
        btn.click()
        print("Cookie banner accettato.")
        time.sleep(2)
    except Exception:
        print("Nessun banner cookie trovato, procedo.")

def scrape():
    print(f"\n[{datetime.datetime.now().strftime('%Y-%m-%d %H:%M')}] Avvio scraping...")
    driver = make_driver()
    accept_cookies(driver)

    today   = datetime.date.today().strftime("%Y-%m-%d")
    results = {}

    for g in GROUPS:
        gid, gurl = g["id"], g["url"]
        print(f"  -> {gid}")
        try:
            driver.get(gurl)
            time.sleep(5)

            found = False
            for xpath in ["//*[contains(text(), 'Membri:')]", "//*[contains(text(), 'members')]"]:
                spans = driver.find_elements(By.XPATH, xpath)
                for span in spans:
                    txt = span.text.strip()
                    m = re.search(r'(?:Membri:|members)[^\d]*([\d.,]+)', txt, re.IGNORECASE)
                    if m:
                        val = parse_membri(m.group(1))
                        if val and val > 0:
                            results[gid] = val
                            print(f"     {val:,} membri")
                            found = True
                            break
                if found:
                    break

            if not found:
                driver.execute_script("window.scrollBy(0, 600);")
                time.sleep(2)
                spans = driver.find_elements(By.XPATH, "//*[contains(text(), 'Membri:')]")
                for span in spans:
                    m = re.search(r'Membri:\s*([\d.]+)', span.text)
                    if m:
                        val = parse_membri(m.group(1))
                        if val and val > 0:
                            results[gid] = val
                            print(f"     {val:,} (scroll)")
                            found = True
                            break

            if not found:
                print(f"     non trovato")

        except Exception as e:
            print(f"     ERRORE: {e}")

        time.sleep(2)

    driver.quit()

    if not results:
        print("Nessun dato raccolto.")
        return

    with open(DATA_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    snapshots = data.get("snapshots", [])
    existing  = next((s for s in snapshots if s["date"] == today), None)
    if existing:
        existing["data"].update(results)
        print(f"Snapshot {today} aggiornato.")
    else:
        snapshots.append({"date": today, "data": results})
        print(f"Nuovo snapshot {today}.")

    snapshots.sort(key=lambda s: s["date"])
    data["snapshots"] = snapshots

    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"Fatto. {len(results)}/{len(GROUPS)} gruppi.")

if __name__ == "__main__":
    scrape()

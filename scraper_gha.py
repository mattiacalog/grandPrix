"""
Grand Prix Scraper — GitHub Actions version
Headless Chrome su Linux, nessun login richiesto
"""

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.keys import Keys
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
    opts.add_argument("--disable-gpu")
    opts.add_argument("--disable-extensions")
    opts.add_argument("--disable-infobars")
    opts.add_argument("--lang=it-IT")
    opts.add_argument("user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
    opts.add_experimental_option("excludeSwitches", ["enable-automation"])
    opts.add_experimental_option("useAutomationExtension", False)
    driver = webdriver.Chrome(options=opts)
    driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {
        "source": "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
    })
    return driver

SHOTS_DIR    = os.path.join(BASE_DIR, "debug_shots")
COOKIES_PATH = "/tmp/fb_cookies.json"

def is_login_page(driver):
    """True se siamo sulla pagina di login (sessione scaduta)."""
    url = driver.current_url
    src = driver.page_source
    return (
        "login" in url or
        "Log into Facebook" in src or
        "Accedi a Facebook" in src or
        'name="pass"' in src or
        'id="pass"' in src
    )

def try_relogin(driver):
    """Clicca sul profilo salvato e inserisce la password se la sessione è scaduta."""
    password = os.environ.get("FB_PASSWORD", "")
    if not password:
        print("FB_PASSWORD non impostato, impossibile fare re-login.")
        return False

    print("Sessione scaduta — tento re-login automatico...")

    # Prova a cliccare sul primo profilo salvato nella lista
    profile_name = os.environ.get("FB_PROFILE_NAME", "")
    clicked = False

    # Parole da escludere — non sono profili salvati
    EXCLUDE = ['crea', 'nuovo', 'account', 'usa altro', 'profilo', 'accedi', 'login']

    def is_profile_link(el):
        txt = el.text.strip().lower()
        if not txt:
            return False
        return not any(ex in txt for ex in EXCLUDE)

    # Usa execute_script con la stessa query JS che funziona nel browser
    profile_keyword = profile_name.lower() if profile_name else "jennifer"
    js = f"""
        var elements = document.querySelectorAll(
            '[role="button"].x1i10hfl.xjbqb8w.xjqpnuy.xc5r6h4.xqeqjp1.x1phubyo.x13fuv20.x18b5jzi' +
            '.x1q0q8m5.x1t7ytsu.x972fbf.x10w94by.x1qhh985.x14e42zd.x9f619.x1ypdohk.xdl72j9' +
            '.x2lah0s.x3ct3a4.xdj266r.x14z9mp.xat24cr.x1lziwak.xeuugli.xyri2b.x1c1uobl' +
            '.x1n2onr6.x16tdsg8.x1hl2dhg.xggy1nq.x1ja2u2z.x1t137rt.x1q0g3np.x87ps6o' +
            '.x1lku1pv.x1a2a7pz.x1yxzw2v.x16t7cu2.xml3ow8.x1nhnf8p.x175kp8w.x6s0dn4' +
            '.x78zum5.xh8yej3.x1306p81.xxv6tbr'
        );
        var target = Array.from(elements).find(el =>
            el.innerText.toLowerCase().includes("{profile_keyword}")
        );
        if (target) {{ target.click(); return "clicked:" + target.innerText.trim().substring(0,40); }}
        else {{ return "not_found. elementi trovati: " + elements.length; }}
    """
    try:
        result = driver.execute_script(js)
        print(f"JS profile click: {result}")
        if result and result.startswith("clicked"):
            clicked = True
            time.sleep(3)
    except Exception as e:
        print(f"JS profile click fallito: {e}")

    shot(driver, "02_after_profile_click")

    # Cerca il campo password
    try:
        pwd = WebDriverWait(driver, 8).until(
            EC.presence_of_element_located((By.XPATH,
                "//input[@type='password' or @name='pass' or @id='pass']"
            ))
        )
        pwd.clear()
        pwd.send_keys(password)
        time.sleep(1)
        shot(driver, "03_password_entered")

        # Submit — prova bottone, fallback su Enter
        try:
            btn = driver.find_element(By.XPATH,
                "//button[@type='submit' or contains(@data-testid,'royal_login_button')]"
            )
            btn.click()
        except Exception:
            pwd.send_keys(Keys.RETURN)

        time.sleep(6)
        shot(driver, "04_after_login")
        print(f"Re-login eseguito. Titolo: {driver.title}")
        return True

    except Exception as e:
        print(f"Re-login fallito: {e}")
        shot(driver, "02_relogin_failed")
        return False

def load_cookies(driver):
    if not os.path.exists(COOKIES_PATH):
        print("Nessun cookie trovato, procedo senza login.")
        return
    cookies = json.loads(open(COOKIES_PATH).read())
    driver.get("https://www.facebook.com")
    time.sleep(3)
    for c in cookies:
        cookie = {k: c[k] for k in ("name", "value", "domain", "path", "secure") if k in c}
        if "expirationDate" in c:
            cookie["expiry"] = int(c["expirationDate"])
        try:
            driver.add_cookie(cookie)
        except Exception:
            pass
    driver.refresh()
    time.sleep(4)
    shot(driver, "01_after_cookies")
    print(f"Cookie caricati. Titolo: {driver.title}")

    # Se la sessione è scaduta, tenta re-login automatico
    if is_login_page(driver):
        try_relogin(driver)

def shot(driver, name):
    os.makedirs(SHOTS_DIR, exist_ok=True)
    path = os.path.join(SHOTS_DIR, f"{name}.png")
    driver.save_screenshot(path)
    print(f"Screenshot: {path}")

def accept_cookies(driver):
    driver.get("https://www.facebook.com")
    shot(driver, "01_homepage_load")
    time.sleep(5)
    shot(driver, "02_after_5s")

    keywords = [
        'Consenti tutti i cookie',
        'Allow all cookies',
        'Accept all',
        'Accetta tutto',
        'Accetta tutti',
        'Allow essential and optional cookies',
    ]
    xpath = "//button[" + " or ".join([f"contains(normalize-space(.), '{k}')" for k in keywords]) + "]"

    try:
        btn = WebDriverWait(driver, 15).until(EC.element_to_be_clickable((By.XPATH, xpath)))
        print(f"Cookie banner accettato: '{btn.text.strip()}'")
        btn.click()
        time.sleep(3)
        shot(driver, "03_after_cookie_click")
        return
    except Exception:
        pass

    try:
        btn = driver.find_element(By.CSS_SELECTOR, "[data-cookiebanner='accept_button']")
        btn.click()
        print("Cookie banner accettato via data-cookiebanner.")
        time.sleep(3)
        shot(driver, "03_after_cookie_click")
        return
    except Exception:
        pass

    print("Nessun banner cookie trovato.")
    print(f"Titolo: {driver.title} | URL: {driver.current_url}")
    buttons = driver.find_elements(By.TAG_NAME, "button")
    print(f"Bottoni nella pagina: {len(buttons)}")
    for b in buttons[:15]:
        print(f"  '{b.text.strip()[:80]}'")

def scrape():
    print(f"\n[{datetime.datetime.now().strftime('%Y-%m-%d %H:%M')}] Avvio scraping...")
    driver = make_driver()
    load_cookies(driver)

    now     = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M")
    today   = datetime.date.today().strftime("%Y-%m-%d")
    results = {}

    for g in GROUPS:
        gid, gurl = g["id"], g["url"]
        print(f"  -> {gid}")
        try:
            driver.get(gurl)
            time.sleep(5)
            shot(driver, f"group_{gid}")

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
    # Ogni run è uno snapshot separato con timestamp completo
    existing = next((s for s in snapshots if s["date"] == now), None)
    if existing:
        existing["data"].update(results)
        print(f"Snapshot {now} aggiornato.")
    else:
        snapshots.append({"date": now, "data": results})
        print(f"Nuovo snapshot {now}.")

    snapshots.sort(key=lambda s: s["date"])
    data["snapshots"] = snapshots

    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"Fatto. {len(results)}/{len(GROUPS)} gruppi.")

if __name__ == "__main__":
    scrape()

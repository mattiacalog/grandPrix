"""
Genera data2.json con 30 giorni di dati simulati per testare il sito demo.
"""
import json, os, random, datetime

BASE_DIR  = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(BASE_DIR, "data", "data.json")
OUT_PATH  = os.path.join(BASE_DIR, "data", "data2.json")

with open(DATA_PATH, "r", encoding="utf-8") as f:
    data = json.load(f)

groups = data["groups"]

# Valori di partenza basati sull'unico snapshot reale
real_snap = data["snapshots"][-1]["data"]
start_vals = {g["id"]: real_snap.get(g["id"], 10000) for g in groups}

# Simula 30 giorni di crescita con un po' di rumore
today     = datetime.date.today()
snapshots = []
current   = {gid: v for gid, v in start_vals.items()}

# Partiamo 30 giorni fa
for day_offset in range(-29, 1):
    date = today + datetime.timedelta(days=day_offset)
    snap_data = {}
    for g in groups:
        gid = g["id"]
        # crescita giornaliera casuale tra -20 e +300, con trend positivo
        delta = random.randint(-20, 300)
        # il nostro gruppo cresce un po' di piu
        if gid == "achivieneaprenderlo":
            delta = random.randint(50, 400)
        current[gid] = max(0, current[gid] + delta)
        snap_data[gid] = current[gid]
    snapshots.append({"date": date.strftime("%Y-%m-%d"), "data": snap_data})

out = {"groups": groups, "snapshots": snapshots}
with open(OUT_PATH, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)

print(f"data2.json generato con {len(snapshots)} snapshot.")

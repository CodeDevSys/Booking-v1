# Zwei getrennte Repositories — Anleitung

## Übersicht

| Repository | Inhalt | Link |
|------------|--------|------|
| **booking-mvp** | Dein Buchungs-SaaS (Express, Admin, Kalender) | https://github.com/CodeDevSys/booking-mvp |
| **nexora-landing** | NEXORA Marketing-Website (Next.js) | https://github.com/CodeDevSys/nexora-landing |

Die Projekte sind **nicht** im Code verbunden.

---

## 1. Booking MVP prüfen

Auf GitHub **Branch `main`** auswählen (nicht `nexora-landing`):

https://github.com/CodeDevSys/booking-mvp/tree/main

Dort solltest du u. a. sehen: `index.html`, `admin.html`, `server/`, `script.js`, `package.json`.

Wenn du einen anderen Branch siehst, wirkt es so, als wären Dateien „verschwunden“.

---

## 2. NEXORA in das eigene Repo übertragen

Das Repo **nexora-landing** existiert bereits, ist aber noch leer.

### Option A — GitHub Actions (empfohlen)

1. Personal Access Token erstellen:  
   https://github.com/settings/tokens → **repo** Berechtigung
2. In **booking-mvp**: Settings → Secrets → Actions → **New secret**  
   Name: `NEXORA_REPO_TOKEN` → Token einfügen
3. Workflow starten:  
   https://github.com/CodeDevSys/booking-mvp/actions/workflows/publish-nexora-landing.yml  
   → **Run workflow**
4. Prüfen: https://github.com/CodeDevSys/nexora-landing

### Option B — Manuell im Terminal

```bash
git clone -b nexora-landing https://github.com/CodeDevSys/booking-mvp.git nexora-landing
cd nexora-landing
git remote remove origin
git remote add origin https://github.com/CodeDevSys/nexora-landing.git
git push -u origin nexora-landing:main
```

(Ersetze die URL durch dein Token, falls nötig: `https://DEIN_TOKEN@github.com/...`)

---

## 3. Optional: Branch im booking-mvp löschen

Wenn **nexora-landing** vollständig im eigenen Repo ist:

```bash
git push origin --delete nexora-landing
```

Dann enthält **booking-mvp** nur noch das Buchungsprodukt auf `main`.

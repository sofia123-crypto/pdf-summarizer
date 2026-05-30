# 📄 SummaPDF — Version corrigée

Générateur automatique de résumés de documents PDF via l'API **Groq** (gratuite).

---

## ✅ Corrections apportées

| # | Problème original | Correction |
|---|---|---|
| 1 | `pdf.worker.min.js` local non chargé → PDF.js planté | Worker chargé depuis le **même CDN** que la lib (`cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`) dans `app.js` |
| 2 | `transformers.js` local inutilisable (ESM + modèles distants) | **Supprimé**. Remplacé par l'API **Groq** (cloud, tier gratuit, aucune GPU requise) |
| 3 | Plantage silencieux sous `file://` (Web Workers bloqués) | Détection automatique du protocole `file://` avec bannière d'avertissement |
| 4 | Pas de découpage → crash/troncature sur PDF longs | Texte découpé en blocs de 2 500 mots ; résumés partiels fusionnés |
| 5 | `pdf.min.js` / `pdf.worker.min.js` versionnés localement différemment | Seule la version CDN est utilisée, versions synchronisées |
| 6 | Pas de `package.json` | Projet **100 % statique**, aucune dépendance npm |

---

## 🚀 Installation & lancement

### Prérequis
- Un compte gratuit sur [console.groq.com](https://console.groq.com) → créez une clé API (`gsk_…`)

### Lancement

**Option 1 — VS Code Live Server :**
Ouvrez le dossier dans VS Code → clic droit sur `index.html` → *Open with Live Server*

**Option 2 — Python :**
```bash
cd pdf-summarizer-fixed
python -m http.server 8000
```
Puis ouvrez `http://localhost:8000`

> ⚠️ **Ne pas double-cliquer sur `index.html`** (protocole `file://` bloque PDF.js).

---

## 🗂️ Fichiers du projet

```
pdf-summarizer-fixed/
├── index.html   → Interface utilisateur
├── app.js       → Logique : PDF.js, Groq API, chunking
├── style.css    → Thème sombre glassmorphism
└── README.md    → Ce fichier
```

Les fichiers `pdf.min.js`, `pdf.worker.min.js`, `transformers.js`, `worker.js` de l'original **ne sont plus nécessaires** et peuvent être supprimés.

---

## 🔑 Obtenir une clé Groq (gratuit)

1. Créez un compte sur [console.groq.com](https://console.groq.com)
2. Menu **API Keys** → *Create API Key*
3. Copiez la clé (`gsk_…`) et collez-la dans le champ de l'application

La clé reste uniquement dans votre navigateur et n'est jamais envoyée ailleurs qu'à l'API Groq.

---

## 📐 Architecture

```
PDF uploadé
    ↓ PDF.js (CDN)
Texte extrait
    ↓ Découpage par blocs de 2500 mots (si long)
Bloc(s) de texte
    ↓ Prompt structuré
API Groq (Llama 3 / Mixtral)
    ↓
Résumé(s) partiel(s)
    ↓ Fusion si plusieurs blocs
Résumé final affiché
```

---

*Projet académique · Soufia Bahrini (2EAN) · 2026*

# Déploiement Vercel (frontend) + Railway (backend)

Repo : [Smart_Plannig_IA_JCD](https://github.com/lyesatb/Smart_Plannig_IA_JCD.git)

Pas d’authentification sur cette version (URLs publiques si quelqu’un a le lien).

---

## 0. Pousser le code sur GitHub

Assure-toi que la branche à déployer (ex. `main`) contient bien ce dossier monorepo :

```text
backend/
frontend/
docs/
```

Si ton clone local pointe vers un autre remote :

```bash
git remote add jcdecaux https://github.com/lyesatb/Smart_Plannig_IA_JCD.git
git push jcdecaux main
```

---

## 1. Railway — API backend

1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
2. Choisir `lyesatb/Smart_Plannig_IA_JCD` (repo privé OK)
3. **Settings → Root Directory** : `backend`
4. **Variables** (obligatoire) :

| Variable | Valeur |
|----------|--------|
| `GROQ_API_KEY` | `gsk_...` |
| `GROQ_MODEL_FAST` | `llama-3.1-8b-instant` |
| `GROQ_INSECURE_SKIP_SSL_VERIFY` | `0` (mettre `1` seulement si erreur SSL) |
| `CHROMA_PERSIST_DIR` | `/tmp/chroma` |
| `RAG_COLLECTION` | `smart_planning_rag_bge` |
| `ALLOWED_ORIGINS` | `https://TON-PROJET.vercel.app` (après deploy Vercel) |

5. **Networking** → générer un **domaine public** → copier l’URL, ex.  
   `https://smart-planning-backend-production-xxxx.up.railway.app`
6. Tester : ouvrir `https://TON-URL-RAILWAY/` → JSON `status: running`

Optionnel : volume Railway monté sur `/data` et `CHROMA_PERSIST_DIR=/data/chroma` pour garder le RAG entre redéploiements.

---

## 2. Vercel — Frontend Next.js

1. [vercel.com](https://vercel.com) → **Add New Project** → import `Smart_Plannig_IA_JCD`
2. **Root Directory** : `frontend`
3. Framework : **Next.js** (auto)
4. **Environment Variables** :

| Variable | Valeur |
|----------|--------|
| `API_URL` | Domaine Railway, ex. `https://xxx.up.railway.app` ou `xxx.up.railway.app` (**https ajouté auto**) |
| `NEXT_PUBLIC_API_URL` | (optionnel) même URL — `API_URL` suffit après redeploy |

5. **Deploy**
6. Copier l’URL Vercel, ex. `https://smart-plannig-ia-jcd.vercel.app`

---

## 3. Relier front ↔ back

1. Railway → variable `ALLOWED_ORIGINS` = ton URL Vercel (et domaine custom si tu en as un)
2. Redéployer Railway si tu changes `ALLOWED_ORIGINS`
3. Sur Vercel : ouvrir l’app → **Générer le plan média** (peut prendre 40–90 s)

---

## 4. Checklist dépannage

| Problème | Piste |
|----------|--------|
| « Impossible de joindre l’API » | `NEXT_PUBLIC_API_URL` incorrect ou pas redéployé Vercel après changement |
| Erreur CORS | `ALLOWED_ORIGINS` sur Railway = URL exacte Vercel |
| 429 Groq | Quota ; attendre 1–2 min entre tests |
| RAG vide | Normal au 1er boot ; redémarrage ré-indexe via `startup` |
| Build Vercel échoue | `cd frontend && npm run build` en local pour voir l’erreur |

---

## 5. Sécurité (démo)

- Ne pas committer `.env` ni `GROQ_API_KEY`
- URLs publiques : ne pas partager largement avant auth / VPN
- Présentation OK ; auth `@jcdecaux.com` ou VPN en phase 2

# Smart Planning IA — JCDecaux x Carrefour x Carmila

MVP complet d’une plateforme de Smart Planning IA pour le Retail Media physique DOOH.

## Objectif

Démontrer une solution capable de :

- comprendre une demande commerciale en langage naturel,
- recommander les meilleurs panneaux,
- calculer un score explicable,
- justifier les choix,
- afficher une interface premium pour présentation métier.

## Structure

```text
backend/    API FastAPI + scoring + agent simple
frontend/   Interface Next.js premium
data/       Datasets fake réalistes
docs/       Documentation projet
```

## Lancement rapide sans Docker

### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```

API : http://localhost:8000  
Swagger : http://localhost:8000/docs

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Application : http://localhost:3000

## Lancement avec Docker

```bash
docker compose up --build
```

## Dataset

Le projet inclut :

- 10 000 panneaux simulés
- 5 000 campagnes historiques simulées
- 840 POI simulés

## Scoring MVP

```text
Score =
0.30 × disponibilité
+ 0.20 × audience
+ 0.20 × adéquation cible
+ 0.15 × proximité POI
+ 0.10 × visibilité
+ 0.05 × contraintes métier
```

## Exemples de prompts

```text
Je veux une campagne premium à Paris pour une cible CSP+ autour des gares.
```

```text
Trouve-moi les meilleurs panneaux digitaux disponibles à Lyon pour une campagne food premium.
```

```text
Je veux maximiser la couverture à Marseille pour une campagne jeunes actifs.
```

## Variables d’environnement (Groq + RAG gratuit)

- **LLM** : [Groq](https://console.groq.com/) (clé `gsk_...`, API compatible OpenAI). Variables : `GROQ_API_KEY`, `GROQ_MODEL` (ex. `llama-3.1-8b-instant`).
- **Rétrocompat** : vous pouvez aussi mettre la clé Groq dans `OPENAI_API_KEY` (même préfixe `gsk_`).
- **Embeddings RAG** : par défaut **FastEmbed** (local, CPU, sans clé). Variable `FASTEMBED_MODEL` (ex. `intfloat/multilingual-e5-small`). Avec une clé OpenAI `sk-` / `proj-` et `EMBEDDING_BACKEND=openai`, les embeddings OpenAI sont utilisés.
- Copiez `.env.example` vers `.env` et renseignez `GROQ_API_KEY`. Si vous changiez de fournisseur d’embeddings, videz ou changez `RAG_COLLECTION` / le dossier `CHROMA_PERSIST_DIR` pour éviter un conflit de dimensions dans Chroma.

## Prochaine étape

Ajouter :

- export PDF,
- base PostgreSQL/PostGIS,
- connecteurs données JCDecaux réels.

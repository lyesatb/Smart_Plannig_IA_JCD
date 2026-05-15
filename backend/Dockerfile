FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Désactiver la vérification SSL (réseau entreprise / antivirus / proxy)
ENV PIP_NO_CACHE_DIR=1
ENV PIP_DEFAULT_TIMEOUT=100
ENV PIP_TRUSTED_HOST=pypi.org
ENV PIP_TRUSTED_HOST=files.pythonhosted.org
ENV PIP_TRUSTED_HOST=pythonhosted.org

WORKDIR /app

COPY requirements.txt .

# Ici on force pip à ignorer SSL
RUN pip install --trusted-host pypi.org --trusted-host files.pythonhosted.org --trusted-host pythonhosted.org -r requirements.txt

COPY app ./app

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

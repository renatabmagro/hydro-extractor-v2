# HydroExtractor 🌊

Aplicativo full-stack para extração de dados hidrológicos e séries temporais utilizando a API do Google Earth Engine (GEE) e persistência de dados no Supabase (PostgreSQL).

## 🚀 Visão Geral

O **HydroExtractor** permite aos usuários selecionar pontos de interesse em um mapa interativo, extrair automaticamente a bacia hidrográfica correspondente (usando a base HydroSHEDS) e gerar arquivos raster (MDT, Inundação Histórica e Rede Hidrográfica). Todos os metadados e referências dos arquivos são armazenados de forma segura em um banco de dados relacional (Supabase).

## 🛠 Tecnologias Utilizadas

*   **Frontend:** React, TypeScript, Tailwind CSS, React Leaflet (Mapas), Recharts (Gráficos).
*   **Backend:** Node.js, Express, TypeScript.
*   **Banco de Dados:** Supabase (PostgreSQL).
*   **Processamento Geoespacial:** Google Earth Engine (GEE) Node.js API.

## ⚠️ Segurança e Variáveis de Ambiente

Este projeto lida com credenciais altamente sensíveis. **NUNCA** faça commit de arquivos `.env` ou arquivos JSON de Service Accounts do Google Cloud.

O arquivo `.gitignore` já está configurado para ignorar esses arquivos.

### Configurando o `.env`

1.  Copie o arquivo de template:
    ```bash
    cp .env.example .env
    ```
2.  Abra o arquivo `.env` e preencha as variáveis obrigatórias:
    *   `SUPABASE_URL` e `SUPABASE_ANON_KEY`: Obtidas no painel do seu projeto Supabase (Project Settings -> API).
    *   `GEE_SERVICE_ACCOUNT_JSON`: O conteúdo completo do arquivo JSON da sua Service Account do Google Cloud (em uma única linha) **OU** configure as variáveis `GEE_PRIVATE_KEY`, `GEE_CLIENT_EMAIL` e `GEE_PROJECT_ID` individualmente.

## 💻 Configuração Local (Passo a Passo)

### Pré-requisitos
*   Node.js (v18 ou superior)
*   Conta no Supabase com as tabelas `bacias` e `rasters` criadas.
*   Conta no Google Earth Engine com uma Service Account configurada.

### Instalação

1.  Clone o repositório:
    ```bash
    git clone https://github.com/SEU_USUARIO/hydroextractor.git
    cd hydroextractor
    ```

2.  Instale as dependências:
    ```bash
    npm install
    ```

3.  Configure as variáveis de ambiente (conforme seção acima).

4.  Inicie o servidor de desenvolvimento (Frontend + Backend):
    ```bash
    npm run dev
    ```

O aplicativo estará disponível em `http://localhost:3000`.

## 🗄️ Estrutura do Banco de Dados (Supabase)

Certifique-se de rodar o script SQL abaixo no SQL Editor do seu Supabase antes de iniciar a aplicação:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE bacias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  geometria JSONB,
  geom GEOMETRY(Polygon, 4326),
  area_km2 NUMERIC,
  data_extracao TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE rasters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bacia_id UUID REFERENCES bacias(id) ON DELETE CASCADE,
  tipo_dado TEXT,
  fonte TEXT,
  caminho_url TEXT,
  resolucao NUMERIC
);
```

# Relatório de Desenvolvimento - App de Extração de Dados Hidrológicos (GEE)

## 1. Visão Geral do Aplicativo
O aplicativo é uma ferramenta web full-stack (React + Node.js) projetada para automatizar a extração, visualização e catalogação de dados hidrológicos e topográficos utilizando a API do Google Earth Engine (GEE). Ele permite que o usuário selecione grandes bacias hidrográficas brasileiras e obtenha dados físicos essenciais de forma simplificada.

## 2. Inputs (Entradas do Usuário)
* **Chave de Autenticação (JSON):** Arquivo de chave privada (Service Account) do Google Cloud/Earth Engine para autenticação no backend.
* **Seleção de Bacia Hidrográfica:** O usuário seleciona uma das 12 Regiões Hidrográficas do Brasil (classificação IBGE) através de um menu suspenso.
* **Controles de Visualização:** Checkboxes interativos no mapa para ativar/desativar as camadas geradas (MDT, Rede Hidrográfica, Inundação Histórica).
* **Ações de Gerenciamento:** Comandos para iniciar a extração ou limpar o banco de dados.

## 3. Outputs (Saídas Geradas)
* **Visualização Espacial (Mapa Interativo):**
  * Polígono da Bacia (GeoJSON delimitado automaticamente).
  * Camada de Modelo Digital de Terreno (MDT).
  * Camada de Rede Hidrográfica (Rios).
  * Camada de Inundação Histórica.
* **Banco de Dados Local (`bacia_paraibuna.json` / SQLite conceptual):**
  * **Tabela de Bacias:** ID, Nome, Geometria (GeoJSON), Área (km²) e Data de Extração.
  * **Tabela de Rasters:** ID, ID da Bacia, Tipo de Dado, Fonte (Dataset do GEE), Caminho do Arquivo/URL e Resolução (m).
* **Arquivos Físicos:** Metadados e links de download de arquivos `.tif` salvos na pasta `/dados/` do servidor.

## 4. Funcionalidades Implementadas

### A. Autenticação Segura (GEE)
* Upload de chave JSON do Google Earth Engine.
* Autenticação server-side (backend) para proteger as credenciais do usuário.
* Verificação automática de status de autenticação ao carregar o app.

### B. Motor de Extração de Dados (Backend)
* **Delimitação Automática:** Usa a base *WWF/HydroSHEDS/v1/Basins* para encontrar a geometria da bacia com base nas coordenadas da região selecionada.
* **Cálculo de Área e Escala Dinâmica:** Calcula a área da bacia e ajusta dinamicamente a resolução (escala em metros) da extração para evitar o erro de limite de payload de 48MB do Google Earth Engine (focando em ~2 milhões de pixels).
* **Extração de MDT:** Obtém dados de elevação da base *USGS/SRTMGL1_003* (30m).
* **Rede Hidrográfica:** Extrai rios com área de drenagem > 10 km² usando a base *MERIT/Hydro/v1_0_1*.
* **Inundação Histórica:** Extrai a ocorrência de águas superficiais usando a base *JRC/GSW1_4/GlobalSurfaceWater*.

### C. Interface de Usuário e Visualização (Frontend)
* **Mapa Interativo (Leaflet):** Renderiza dinamicamente as *tiles* geradas pelo GEE diretamente no navegador, com controle de opacidade e sobreposição (zIndex).
* **Painel de Extração:** Feedback visual de carregamento (loading states) e exibição de métricas (ex: área total da bacia mapeada).

### D. Catálogo e Gerenciamento de Dados
* **Visualização Tabular:** Duas tabelas relacionais mostrando os metadados das bacias extraídas e os arquivos raster associados.
* **Limpeza de Dados (Hard Reset):** Botão "Limpar Dados" com dupla confirmação de segurança. Ao ser acionado, limpa os registros do banco de dados JSON e deleta os arquivos físicos residuais na pasta `/dados/`.

## 5. Tecnologias Utilizadas
* **Frontend:** React, Tailwind CSS, Lucide Icons, React-Leaflet.
* **Backend:** Node.js, Express, Google Earth Engine Node.js API (`@google/earthengine`).
* **Armazenamento:** Sistema de arquivos local (JSON atuando como banco de dados relacional leve).

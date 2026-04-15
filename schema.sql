-- Ativar extensão PostGIS para dados espaciais
CREATE EXTENSION IF NOT EXISTS postgis;

-- Tabela bacias
CREATE TABLE bacias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  geometria JSONB,
  geom GEOMETRY(Polygon, 4326), -- Coluna espacial extra (opcional para uso futuro)
  area_km2 NUMERIC,
  data_extracao TIMESTAMPTZ DEFAULT now()
);

-- Tabela rasters
CREATE TABLE rasters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bacia_id UUID REFERENCES bacias(id) ON DELETE CASCADE,
  tipo_dado TEXT,
  fonte TEXT,
  caminho_url TEXT,
  resolucao NUMERIC
);

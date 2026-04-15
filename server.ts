import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import ee from "@google/earthengine";
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import * as turf from '@turf/turf';
import { XMLParser } from 'fast-xml-parser';

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Supabase Client Configuration
let supabase: ReturnType<typeof createClient> | null = null;

function getSupabase() {
  if (!supabase) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Supabase is not configured. Please set SUPABASE_URL and SUPABASE_ANON_KEY environment variables.");
    }
    supabase = createClient(supabaseUrl, supabaseKey);
  }
  return supabase;
}

// Create data directory
const dataDir = path.join(process.cwd(), "dados");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// API Routes
let isGeeAuthenticated = false;

const authenticateWithGEE = (credentials: any): Promise<void> => {
  return new Promise((resolve, reject) => {
    ee.data.authenticateViaPrivateKey(
      credentials,
      () => {
        ee.initialize(
          null,
          null,
          () => {
            isGeeAuthenticated = true;
            console.log("GEE Authenticated Successfully");
            resolve();
          },
          (e: any) => reject(new Error("Initialization error: " + e))
        );
      },
      (e: any) => reject(new Error("Authentication error: " + e))
    );
  });
};

// Auto-auth on startup if env vars are present
if (process.env.GEE_SERVICE_ACCOUNT_JSON) {
  try {
    const credentials = JSON.parse(process.env.GEE_SERVICE_ACCOUNT_JSON);
    authenticateWithGEE(credentials).catch(console.error);
  } catch (e) {
    console.error("Failed to parse GEE_SERVICE_ACCOUNT_JSON environment variable:", e);
  }
} else if (process.env.GEE_PRIVATE_KEY && process.env.GEE_CLIENT_EMAIL) {
  const credentials = {
    private_key: process.env.GEE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    client_email: process.env.GEE_CLIENT_EMAIL,
    project_id: process.env.GEE_PROJECT_ID || ""
  };
  authenticateWithGEE(credentials).catch(console.error);
} else {
  // Try to load from gee-key.json
  const keyPath = path.join(process.cwd(), "gee-key.json");
  if (fs.existsSync(keyPath)) {
    try {
      const keyObj = JSON.parse(fs.readFileSync(keyPath, "utf-8"));
      authenticateWithGEE(keyObj).catch(console.error);
    } catch (e) {
      console.error("Failed to parse gee-key.json:", e);
    }
  }
}

app.get("/api/gee/status", (req, res) => {
  res.json({ authenticated: isGeeAuthenticated });
});

app.post("/api/gee/key", async (req, res) => {
  try {
    const keyData = req.body;
    if (!keyData || !keyData.private_key) {
      return res.status(400).json({ error: "Formato de chave inválido." });
    }
    
    await authenticateWithGEE(keyData);
    
    const keyPath = path.join(process.cwd(), "gee-key.json");
    fs.writeFileSync(keyPath, JSON.stringify(keyData, null, 2));
    res.json({ success: true, message: "Chave salva e autenticada com sucesso." });
  } catch (err: any) {
    res.status(500).json({ error: "Erro ao salvar a chave: " + err.message });
  }
});

app.post("/api/gee/auth", async (req, res) => {
  if (isGeeAuthenticated) {
    return res.json({ success: true, message: "Already authenticated" });
  }

  try {
    const keyPath = path.join(process.cwd(), "gee-key.json");
    if (!fs.existsSync(keyPath)) {
      return res.status(400).json({ error: "Chave GEE não encontrada no servidor." });
    }

    const keyObj = JSON.parse(fs.readFileSync(keyPath, "utf-8"));
    await authenticateWithGEE(keyObj);
    res.json({ success: true, message: "Authenticated successfully" });
  } catch (err: any) {
    res.status(500).json({ error: "Internal error: " + err.message });
  }
});

app.post("/api/extract", async (req, res) => {
  if (!isGeeAuthenticated) {
    return res.status(401).json({ error: "Google Earth Engine não está autenticado. Verifique as credenciais no servidor." });
  }

  const { lat, lng, basinName, level } = req.body;

  if (!lat || !lng || !basinName) {
    return res.status(400).json({ error: "Missing parameters" });
  }

  const hydroLevel = level || 8;

  try {
    // 3. Delimitação Automática da Bacia
    const ponto_referencia = ee.Geometry.Point([parseFloat(lng), parseFloat(lat)]);
    const bacias = ee.FeatureCollection(`WWF/HydroSHEDS/v1/Basins/hybas_${hydroLevel}`);
    const bacia_feature = bacias.filterBounds(ponto_referencia).first();
    const bacia_geom = bacia_feature.geometry();

    // Extrair metadados físicos
    const area_bacia_ee = bacia_geom.area().divide(1e6);
    
    // Evaluate geometry and area
    bacia_geom.evaluate(async (geomGeojson: any, errorGeom: any) => {
      if (errorGeom) return res.status(500).json({ error: errorGeom });

      area_bacia_ee.evaluate(async (area_km2: number, errorArea: any) => {
        if (errorArea) return res.status(500).json({ error: errorArea });

        // Calculate dynamic scale to avoid GEE payload limits for huge basins
        // Max payload size is 48MB. We target around 2 million pixels to be safe
        // considering the bounding box can be larger than the polygon area.
        let calcScale = Math.sqrt((area_km2 * 1000000) / 2000000);
        calcScale = Math.max(30, Math.ceil(calcScale)); // Minimum 30m resolution

        const geom_geojson_str = JSON.stringify(geomGeojson);
        const data_extracao = new Date().toISOString().replace("T", " ").substring(0, 19);

        // Registrar bacia no Banco de Dados (Supabase)
        const { data: baciaData, error: baciaError } = await getSupabase()
          .from('bacias')
          .insert([{
            nome: basinName,
            geometria: geomGeojson,
            area_km2: area_km2
          }])
          .select()
          .single();

        if (baciaError) {
          console.error("Erro ao inserir bacia no Supabase:", baciaError);
          return res.status(500).json({ error: "Erro ao salvar bacia no banco de dados." });
        }

        const bacia_id = baciaData.id;

        // 4. Extração do MDT (Modelo Digital de Terreno) - SRTM 30m
        const mdt = ee.Image("USGS/SRTMGL1_003").clip(bacia_geom);
        const mdt_path = `dados/mdt_${bacia_id}.tif`;

        // 5. Extração de Dados Históricos de Inundação
        const historico_inundacao = ee.Image("JRC/GSW1_4/GlobalSurfaceWater").select("occurrence").clip(bacia_geom);
        const inundacao_path = `dados/inundacao_${bacia_id}.tif`;

        // 6. Rede Hidrográfica (MERIT Hydro - Upstream Drainage Area > 10 km2)
        const riosImg = ee.Image("MERIT/Hydro/v1_0_1").select('upa').clip(bacia_geom).gt(10);
        const riosMasked = riosImg.updateMask(riosImg);
        const riosVis = { palette: ['0000ff'] };

        // Gerar Map IDs para visualização no frontend
        const mdtVis = { min: 0, max: 2000, palette: ['006600', '002200', 'fff700', 'ab7634', 'c4d0ff', 'ffffff'] };
        const inundacaoMasked = historico_inundacao.updateMask(historico_inundacao.gt(0));
        const inundacaoVis = { min: 0, max: 100, palette: ['lightblue', 'blue', 'darkblue'] };

        mdt.getMap(mdtVis, (mapIdMdt: any, errMapMdt: any) => {
          const mdtTileUrl = mapIdMdt ? mapIdMdt.urlFormat : null;

          riosMasked.getMap(riosVis, (mapIdRios: any, errMapRios: any) => {
            const riosTileUrl = mapIdRios ? mapIdRios.urlFormat : null;

            inundacaoMasked.getMap(inundacaoVis, (mapIdInundacao: any, errMapInundacao: any) => {
              const inundacaoTileUrl = mapIdInundacao ? mapIdInundacao.urlFormat : null;

              // We will just save the metadata to DB. Downloading large TIFFs via Node.js requires getDownloadURL and fetching.
            // For demonstration, we will get the download URL and save the metadata.
            
            mdt.getDownloadURL({
              scale: calcScale,
              region: bacia_geom,
              format: "GEO_TIFF"
            }, async (mdtUrl: string, errMdt: any) => {
              if (errMdt) {
                console.error("Error getting MDT URL:", errMdt);
              }
              if (!errMdt) {
                await getSupabase().from('rasters').insert([{
                  bacia_id: bacia_id,
                  tipo_dado: "MDT",
                  fonte: "USGS/SRTMGL1_003",
                  caminho_url: mdt_path + " (URL: " + mdtUrl.split('?')[0].substring(0, 60) + "...)",
                  resolucao: calcScale
                }]);
              }

              historico_inundacao.getDownloadURL({
                scale: calcScale,
                region: bacia_geom,
                format: "GEO_TIFF"
              }, async (inundacaoUrl: string, errInundacao: any) => {
                if (!errInundacao) {
                  await getSupabase().from('rasters').insert([{
                    bacia_id: bacia_id,
                    tipo_dado: "Inundacao_Historica",
                    fonte: "JRC/GSW1_4/GlobalSurfaceWater",
                    caminho_url: inundacao_path + " (URL: " + inundacaoUrl.split('?')[0].substring(0, 60) + "...)",
                    resolucao: calcScale
                  }]);
                }

                riosImg.getDownloadURL({
                  scale: calcScale,
                  region: bacia_geom,
                  format: "GEO_TIFF"
                }, async (riosUrl: string, errRios: any) => {
                  if (!errRios) {
                    await getSupabase().from('rasters').insert([{
                      bacia_id: bacia_id,
                      tipo_dado: "Rede_Hidrografica",
                      fonte: "MERIT/Hydro/v1_0_1",
                      caminho_url: `dados/rios_${bacia_id}.tif` + " (URL: " + riosUrl.split('?')[0].substring(0, 60) + "...)",
                      resolucao: calcScale
                    }]);
                  }

                  res.json({
                    success: true,
                    bacia_id,
                    area_km2,
                    geomGeojson,
                    mdtTileUrl,
                    riosTileUrl,
                    inundacaoTileUrl,
                    message: `Sucesso! Bacia mapeada (${area_km2.toFixed(2)} km²). Banco de dados atualizado.`
                  });
                });
              });
            });
            });
          });
        });
      });
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/catalog/bacias", async (req, res) => {
  try {
    const { data, error } = await getSupabase().from('bacias').select('*');
    if (error) throw error;
    
    // Mapear para o formato esperado pelo frontend (se necessário)
    const formattedData = data.map(b => ({
      id: b.id,
      nome_bacia: b.nome,
      geometria_geojson: JSON.stringify(b.geometria),
      area_km2: b.area_km2,
      data_extracao: b.data_extracao
    }));
    
    res.json(formattedData);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/catalog/rasters", async (req, res) => {
  try {
    const { data, error } = await getSupabase().from('rasters').select('*');
    if (error) throw error;
    
    // Mapear para o formato esperado pelo frontend
    const formattedData = data.map(r => ({
      id: r.id,
      bacia_id: r.bacia_id,
      tipo_dado: r.tipo_dado,
      fonte: r.fonte,
      caminho_arquivo: r.caminho_url,
      resolucao_m: r.resolucao
    }));
    
    res.json(formattedData);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/catalog/clear", async (req, res) => {
  try {
    // Deleta todas as bacias. O ON DELETE CASCADE no banco apagará os rasters.
    const { error } = await getSupabase()
      .from('bacias')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Deleta tudo
      
    if (error) throw error;
    
    const dataDir = path.join(process.cwd(), "dados");
    if (fs.existsSync(dataDir)) {
      fs.readdirSync(dataDir).forEach(file => {
        fs.unlinkSync(path.join(dataDir, file));
      });
    }
    
    res.json({ success: true, message: "Dados limpos com sucesso." });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/timeseries', async (req, res) => {
  if (!isGeeAuthenticated) {
    return res.status(401).json({ error: "Google Earth Engine não está autenticado. Verifique as credenciais no servidor." });
  }

  const { geoJson, startDate, endDate } = req.body;

  if (!geoJson || !startDate || !endDate) {
    return res.status(400).json({ error: 'Parâmetros ausentes (geoJson, startDate, endDate)' });
  }

  try {
    // 1. Converte o GeoJSON do frontend para ee.Geometry
    const feature = ee.Feature(geoJson.features ? geoJson.features[0] : geoJson);
    const geometry = feature.geometry();

    // 2. Extração de Precipitação Mensal (TerraClimate)
    const precipCollection = ee.ImageCollection('IDAHO_EPSCOR/TERRACLIMATE')
      .filterBounds(geometry)
      .filterDate(startDate, endDate)
      .select('pr'); // pr = Precipitation (mm)

    const precipData = precipCollection.map(function(image: any) {
      const date = image.date().format('YYYY-MM');
      const mean = image.reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: geometry,
        scale: 4000, // Escala nativa do TerraClimate (~4km)
        maxPixels: 1e10
      });
      return ee.Feature(null, { date: date, precip_mm: mean.get('pr') });
    });

    // 3. Extração de Área Inundada Mensal (NDWI via Landsat 8)
    const l8Collection = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
      .filterBounds(geometry)
      .filterDate(startDate, endDate);

    const maskClouds = function(image: any) {
      const qa = image.select('QA_PIXEL');
      const cloudBitMask = 1 << 3;
      const cirrusBitMask = 1 << 4;
      const mask = qa.bitwiseAnd(cloudBitMask).eq(0)
        .and(qa.bitwiseAnd(cirrusBitMask).eq(0));
      return image.updateMask(mask);
    };

    const start = ee.Date(startDate);
    const end = ee.Date(endDate);
    const numMonths = end.difference(start, 'month').round();
    const months = ee.List.sequence(0, numMonths.subtract(1));

    const waterData = ee.FeatureCollection(months.map(function(n: any) {
      const mStart = start.advance(n, 'month');
      const mEnd = mStart.advance(1, 'month');
      const dateStr = mStart.format('YYYY-MM');

      const col = l8Collection.filterDate(mStart, mEnd);
      
      const dummyImage = ee.Image.constant([0, 0, 0]).rename(['SR_B3', 'SR_B5', 'QA_PIXEL']).updateMask(0);
      const safeCol = ee.ImageCollection(ee.Algorithms.If(col.size().gt(0), col, ee.ImageCollection([dummyImage])));
      
      const area = safeCol.map(maskClouds).median().clip(geometry)
        .normalizedDifference(['SR_B3', 'SR_B5']).rename('ndwi')
        .gt(0)
        .multiply(ee.Image.pixelArea())
        .reduceRegion({
          reducer: ee.Reducer.sum(),
          geometry: geometry,
          scale: 500, // Reduced scale to avoid timeout
          maxPixels: 1e13
        }).get('ndwi');

      return ee.Feature(null, { date: dateStr, water_area_km2: area });
    }));

    // 4. Executa no GEE e traz para o Node.js
    // Usamos Promessas para avaliar paralelamente e ganhar tempo
    console.log(`Iniciando extração GEE para datas ${startDate} a ${endDate}...`);
    const [precipList, waterList] = await Promise.all([
      new Promise<any>((resolve, reject) => precipData.evaluate((data: any, err: any) => err ? reject(err) : resolve(data))),
      new Promise<any>((resolve, reject) => waterData.evaluate((data: any, err: any) => err ? reject(err) : resolve(data)))
    ]);
    console.log(`Extração concluída. Precipitação: ${precipList?.features?.length || 0} meses. Água: ${waterList?.features?.length || 0} meses.`);

    // 5. Mescla os dados pelo Mês/Ano para o Frontend
    const chartData: Record<string, any> = {};

    // Adiciona Precipitação
    if (precipList && precipList.features) {
      precipList.features.forEach((f: any) => {
        chartData[f.properties.date] = { 
          date: f.properties.date, 
          precip_mm: f.properties.precip_mm || 0 
        };
      });
    }

    // Adiciona Área de Água
    if (waterList && waterList.features) {
      waterList.features.forEach((f: any) => {
        let area = f.properties.water_area_km2;
        if (area === null || area === undefined) area = 0;
        else area = area / 1e6;

        if (chartData[f.properties.date]) {
          chartData[f.properties.date].water_area_km2 = area;
        } else {
          chartData[f.properties.date] = {
            date: f.properties.date,
            precip_mm: 0,
            water_area_km2: area
          };
        }
      });
    }

    // Converte o dicionário mesclado em um Array ordenado
    const finalResult = Object.values(chartData).sort((a: any, b: any) => a.date.localeCompare(b.date));

    res.json(finalResult);

  } catch (error: any) {
    console.error('Erro na extração de série temporal:', error);
    res.status(500).json({ error: 'Erro ao processar dados no Google Earth Engine', details: error.message });
  }
});

// Nova Rota para gerar a Camada Visual (O Mapa Interativo)
app.post('/api/ndwi-layer', async (req, res) => {
  if (!isGeeAuthenticated) {
    return res.status(401).json({ error: "Google Earth Engine não está autenticado. Verifique as credenciais no servidor." });
  }

  const { geoJson, targetMonth } = req.body;

  try {
    let geometry;
    if (geoJson.features && geoJson.features.length > 0) {
      geometry = ee.Feature(geoJson.features[0]).geometry();
    } else {
      geometry = ee.Geometry(geoJson);
    }
    
    // Define o início e o fim do mês selecionado pelo usuário
    const startDate = ee.Date(targetMonth + '-01');
    const endDate = startDate.advance(1, 'month');

    // Usa a coleção Landsat 8 (muito robusta para histórico longo)
    const collection = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
      .filterBounds(geometry)
      .filterDate(startDate, endDate);

    const dummyImage = ee.Image.constant([0, 0, 0]).rename(['SR_B3', 'SR_B5', 'QA_PIXEL']).updateMask(0);
    const safeCol = ee.ImageCollection(ee.Algorithms.If(collection.size().gt(0), collection, ee.ImageCollection([dummyImage])));

    // Função de máscara de nuvens Landsat 8
    const maskClouds = function(image: any) {
      const qa = image.select('QA_PIXEL');
      const cloudBitMask = 1 << 3;
      const cirrusBitMask = 1 << 4;
      const mask = qa.bitwiseAnd(cloudBitMask).eq(0)
        .and(qa.bitwiseAnd(cirrusBitMask).eq(0));
      return image.updateMask(mask);
    };

    // Aplica máscara, calcula mediana do mês e corta para a bacia
    const monthlyImage = safeCol.map(maskClouds).median().clip(geometry);

    // Calcula o NDWI: (Green - NIR) / (Green + NIR) -> (B3 - B5) no Landsat 8
    const ndwi = monthlyImage.normalizedDifference(['SR_B3', 'SR_B5']).rename('NDWI');

    // Isola apenas a água (NDWI > 0)
    const waterMask = ndwi.gt(0).selfMask(); 

    // Prepara a visualização (Azul escuro, semi-transparente)
    const visParams = { min: 0, max: 1, palette: ['0000FF'] };

    // Pede ao GEE a URL dos Tiles
    waterMask.getMap(visParams, (mapObj: any, err: any) => {
      if (err) return res.status(500).json({ error: err });
      res.json({ urlFormat: mapObj.urlFormat }); // Retorna a URL dinâmica para o Frontend!
    });

  } catch (error: any) {
    res.status(500).json({ error: 'Erro ao gerar mapa NDWI: ' + error.message });
  }
});

// Rota para download do banco de dados (bacia_paraibuna.json)
app.get("/api/export/db", async (req, res) => {
  try {
    const { data: bacias, error: baciasError } = await getSupabase().from('bacias').select('*');
    const { data: rasters, error: rastersError } = await getSupabase().from('rasters').select('*');

    if (baciasError || rastersError) {
      throw new Error("Erro ao buscar dados do Supabase");
    }

    const exportData = {
      bacia_metadata: bacias,
      raster_data: rasters
    };

    res.setHeader("Content-Disposition", 'attachment; filename="bacia_paraibuna.json"');
    res.setHeader("Content-Type", "application/json");
    res.send(JSON.stringify(exportData, null, 2));
  } catch (error: any) {
    res.status(500).json({ error: "Erro ao exportar banco de dados: " + error.message });
  }
});

// Rota para exportar CSV da série temporal
app.post("/api/export/csv", (req, res) => {
  try {
    const { data } = req.body;
    if (!data || !Array.isArray(data) || data.length === 0) {
      return res.status(400).json({ error: "Dados inválidos para exportação CSV." });
    }

    // Extrair cabeçalhos dinamicamente das chaves do primeiro objeto
    const headers = Object.keys(data[0]);
    const csvRows = [];
    
    // Adicionar cabeçalho
    csvRows.push(headers.join(","));
    
    // Adicionar linhas
    for (const row of data) {
      const values = headers.map(header => {
        const val = row[header];
        // Escapar aspas e tratar strings com vírgulas
        if (typeof val === 'string') {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      });
      csvRows.push(values.join(","));
    }
    
    const csvString = csvRows.join("\n");
    
    res.setHeader("Content-Disposition", 'attachment; filename="serie_historica.csv"');
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.send(csvString);
  } catch (error: any) {
    res.status(500).json({ error: "Erro ao exportar CSV: " + error.message });
  }
});

// Rota para exportar rasters físicos
app.get("/api/export/raster/:id", async (req, res) => {
  if (!isGeeAuthenticated) {
    return res.status(401).json({ error: "Google Earth Engine não está autenticado." });
  }

  try {
    const rasterId = req.params.id;
    
    const { data: raster, error: rasterError } = await getSupabase()
      .from('rasters')
      .select('*')
      .eq('id', rasterId)
      .single();
      
    if (rasterError || !raster) {
      return res.status(404).json({ error: "Raster não encontrado no banco de dados." });
    }

    const { data: bacia, error: baciaError } = await getSupabase()
      .from('bacias')
      .select('*')
      .eq('id', raster.bacia_id)
      .single();
      
    if (baciaError || !bacia) {
      return res.status(404).json({ error: "Bacia não encontrada." });
    }

    const bacia_geom = ee.Geometry(bacia.geometria);
    let imageToExport;

    if (raster.tipo_dado === "MDT") {
      imageToExport = ee.Image("USGS/SRTMGL1_003").clip(bacia_geom);
    } else if (raster.tipo_dado === "Inundacao_Historica") {
      imageToExport = ee.Image("JRC/GSW1_4/GlobalSurfaceWater").select("occurrence").clip(bacia_geom);
    } else if (raster.tipo_dado === "Rede_Hidrografica") {
      const riosImg = ee.Image("MERIT/Hydro/v1_0_1").select('upa').clip(bacia_geom).gt(10);
      imageToExport = riosImg.updateMask(riosImg);
    } else {
      return res.status(400).json({ error: "Tipo de raster não suportado." });
    }

    imageToExport.getDownloadURL({
      scale: raster.resolucao || 30,
      crs: 'EPSG:4326',
      region: bacia_geom
    }, (url: string, error: any) => {
      if (error) {
        return res.status(500).json({ error: "Erro ao gerar URL de download no GEE: " + error });
      }
      res.redirect(url);
    });
  } catch (error: any) {
    res.status(500).json({ error: "Erro interno: " + error.message });
  }
});

// Rota para gerar link de download do GEE (Alternativa Escalável)
app.post("/api/export/gee-raster", async (req, res) => {
  if (!isGeeAuthenticated) {
    return res.status(401).json({ error: "Google Earth Engine não está autenticado." });
  }

  try {
    const { geoJson, targetMonth, type } = req.body;

    if (!geoJson || !targetMonth) {
      return res.status(400).json({ error: "Parâmetros ausentes." });
    }

    let geometry;
    if (geoJson.features && geoJson.features.length > 0) {
      geometry = ee.Feature(geoJson.features[0]).geometry();
    } else {
      geometry = ee.Geometry(geoJson);
    }
    const [year, month] = targetMonth.split('-');
    const startDate = ee.Date.fromYMD(Number(year), Number(month), 1);
    const endDate = startDate.advance(1, 'month');

    let imageToExport;

    if (type === 'ndwi') {
      const collection = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
        .filterBounds(geometry)
        .filterDate(startDate, endDate)
        .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20));

      const image = collection.median().clip(geometry);
      const ndwi = image.normalizedDifference(['B3', 'B8']).rename('NDWI');
      imageToExport = ndwi;
    } else {
      return res.status(400).json({ error: "Tipo de raster não suportado para exportação direta do GEE ainda." });
    }

    imageToExport.getDownloadURL({
      scale: 30,
      crs: 'EPSG:4326',
      region: geometry
    }, (url: string, error: any) => {
      if (error) {
        return res.status(500).json({ error: "Erro ao gerar URL de download no GEE: " + error });
      }
      res.json({ downloadUrl: url });
    });
  } catch (error: any) {
    res.status(500).json({ error: "Erro interno: " + error.message });
  }
});

// Rota para buscar estações de monitoramento (ANA e INMET) dentro de uma bacia
app.post("/api/estacoes", async (req, res) => {
  try {
    const { geometria } = req.body;
    if (!geometria) {
      return res.status(400).json({ error: "Geometria da bacia não fornecida." });
    }

    const estacoes: turf.Feature<turf.Point>[] = [];

    // 1. Fetch INMET (Estações Automáticas)
    try {
      const inmetRes = await axios.get("https://apitempo.inmet.gov.br/estacoes/T");
      const inmetData = inmetRes.data;
      if (Array.isArray(inmetData)) {
        inmetData.forEach((est: any) => {
          if (est.VL_LATITUDE && est.VL_LONGITUDE) {
            estacoes.push(turf.point([parseFloat(est.VL_LONGITUDE), parseFloat(est.VL_LATITUDE)], {
              origem: "INMET",
              nome: est.DC_NOME,
              codigo: est.CD_ESTACAO,
              tipo: "Meteorológica"
            }));
          }
        });
      }
    } catch (e: any) {
      console.error("Erro ao buscar estações do INMET:", e.message);
    }

    // 2. Fetch ANA (Estações Telemétricas)
    try {
      const anaRes = await axios.get("http://telemetriaws1.ana.gov.br/ServiceANA.asmx/ListaEstacoesTelemetricas?statusEquipamento=1");
      const parser = new XMLParser();
      const anaData = parser.parse(anaRes.data);
      const estacoesAna = anaData?.DataTable?.diffgram?.DocumentElement?.Estacoes || [];
      const estacoesArray = Array.isArray(estacoesAna) ? estacoesAna : [estacoesAna];

      estacoesArray.forEach((est: any) => {
        if (est.Latitude && est.Longitude) {
          estacoes.push(turf.point([parseFloat(est.Longitude), parseFloat(est.Latitude)], {
            origem: "ANA",
            nome: est.Nome,
            codigo: est.Codigo,
            tipo: est.TipoEstacao === 1 ? "Fluviométrica" : "Pluviométrica"
          }));
        }
      });
    } catch (e: any) {
      if (e.response && e.response.status === 500) {
        // Ignora silenciosamente o erro 500, pois a API da ANA é instável
      } else {
        console.error("Erro ao buscar estações da ANA:", e.message);
      }
    }

    // 3. Filtragem Espacial com Turf.js
    const points = turf.featureCollection(estacoes);
    const searchPolygon = geometria.type === "Feature" ? geometria : turf.feature(geometria);
    
    // Filtra os pontos que estão dentro do polígono da bacia
    const filtered = turf.pointsWithinPolygon(points, searchPolygon as any);

    // Formata a resposta para o frontend
    const resultado = filtered.features.map(f => ({
      ...f.properties,
      latitude: f.geometry.coordinates[1],
      longitude: f.geometry.coordinates[0]
    }));

    res.json(resultado);

  } catch (error: any) {
    console.error("Erro na rota /api/estacoes:", error);
    res.status(500).json({ error: "Erro interno ao processar estações." });
  }
});

// Rota para buscar dados de telemetria em tempo real de uma estação específica
app.get("/api/telemetria/:orgao/:codigo", async (req, res) => {
  const { orgao, codigo } = req.params;
  
  try {
    if (orgao === 'INMET') {
      const today = new Date().toISOString().split('T')[0];
      const url = `https://apitempo.inmet.gov.br/estacao/dados/${today}/${today}/${codigo}`;
      
      const response = await axios.get(url);
      const data = response.data;
      
      if (!data || !Array.isArray(data) || data.length === 0 || data[0].DC_NOME === null) {
        return res.json({ status: 'offline', mensagem: 'Sem transmissão nas últimas 24h' });
      }

      // Encontra o último registro válido (do mais recente para o mais antigo)
      const lastRecord = [...data].reverse().find((d: any) => d.TEM_INS !== null || d.CHUVA !== null);
      
      if (!lastRecord) {
        return res.json({ status: 'offline', mensagem: 'Sem transmissão nas últimas 24h' });
      }
      
      return res.json({
        codigo,
        orgao,
        data_leitura: `${lastRecord.DT_MEDICAO} às ${lastRecord.HR_MEDICAO.substring(0,2)}:${lastRecord.HR_MEDICAO.substring(2,4)}`,
        nivel_cm: null,
        vazao_m3s: null,
        chuva_mm: lastRecord.CHUVA ? parseFloat(lastRecord.CHUVA) : null,
        temperatura_c: lastRecord.TEM_INS ? parseFloat(lastRecord.TEM_INS) : null,
        status: 'online'
      });

    } else if (orgao === 'ANA') {
      const codigoFormatado = codigo.toString().padStart(8, '0');
      const url = `http://telemetriaws1.ana.gov.br/ServiceANA.asmx/DadosTempoReal?codEstacao=${codigoFormatado}`;
      const response = await axios.get(url);
      
      const parser = new XMLParser();
      const parsed = parser.parse(response.data);
      
      // Correção do caminho do XML gerado pelo webservice da ANA
      const dadosAna = parsed?.DataTable?.['diffgr:diffgram']?.DocumentElement?.DadosTempoReal;

      if (!dadosAna) {
        return res.json({ status: 'offline', mensagem: 'Sem transmissão nas últimas 24h' });
      }

      const records = Array.isArray(dadosAna) ? dadosAna : [dadosAna];
      if (records.length === 0) {
        return res.json({ status: 'offline', mensagem: 'Sem transmissão nas últimas 24h' });
      }

      // A ANA geralmente retorna o mais recente primeiro ou precisamos pegar o primeiro válido
      const lastRecord = records[0]; 

      // Formatação de data da ANA (vem como YYYY-MM-DDTHH:mm:ss)
      let dataFormatada = lastRecord.Horario;
      if (dataFormatada && dataFormatada.includes('T')) {
        const [data, hora] = dataFormatada.split('T');
        const [ano, mes, dia] = data.split('-');
        dataFormatada = `${dia}/${mes}/${ano} às ${hora.substring(0,5)}`;
      }

      return res.json({
        codigo,
        orgao,
        data_leitura: dataFormatada,
        nivel_cm: lastRecord.Nivel ? parseFloat(lastRecord.Nivel) : null,
        vazao_m3s: lastRecord.Vazao ? parseFloat(lastRecord.Vazao) : null,
        chuva_mm: lastRecord.Chuva ? parseFloat(lastRecord.Chuva) : null,
        temperatura_c: null,
        status: 'online'
      });

    } else {
      return res.status(400).json({ error: 'Órgão inválido' });
    }
  } catch (error: any) {
    // Não logar erro 404 para INMET, pois é esperado quando não há dados no dia
    if (orgao === 'INMET' && error.response && error.response.status === 404) {
      // Silencioso
    } else {
      console.error(`Erro ao buscar telemetria para ${orgao} ${codigo}:`, error.message);
    }
    return res.json({ status: 'offline', mensagem: 'Sem transmissão nas últimas 24h' });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

import React, { useState, useRef, useEffect } from 'react';
import { 
  ComposedChart, Area, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from 'recharts';
import { Loader2, AlertCircle, Map as MapIcon, Download, FileText } from 'lucide-react';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const MapUpdater = ({ geojson }: { geojson: any }) => {
  const map = useMap();
  useEffect(() => {
    if (geojson) {
      const layer = L.geoJSON(geojson);
      map.fitBounds(layer.getBounds(), { padding: [20, 20] });
    }
  }, [geojson, map]);
  return null;
};

interface TimeSeriesChartProps {
  selectedBasinGeoJSON: any;
}

const TimeSeriesChart: React.FC<TimeSeriesChartProps> = ({ selectedBasinGeoJSON }) => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [dates, setDates] = useState({ start: '2018-01-01', end: '2020-12-31' });
  const chartRef = useRef<HTMLDivElement>(null);
  
  const [ndwiTileUrl, setNdwiTileUrl] = useState<string | null>(null);
  const [mapLoading, setMapLoading] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  const fetchMapLayerForMonth = async (monthClicked: string) => {
    setSelectedMonth(monthClicked);
    setMapLoading(true);
    setNdwiTileUrl(null);
    setErrorMsg(null);
    try {
      const response = await fetch('/api/ndwi-layer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          geoJson: selectedBasinGeoJSON,
          targetMonth: monthClicked
        })
      });
      const result = await response.json();
      if (response.ok) {
        setNdwiTileUrl(result.urlFormat);
      } else {
        setErrorMsg("Erro ao gerar mapa: " + (result.error || "Falha na requisição"));
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Erro de conexão com o servidor: " + err.message);
    } finally {
      setMapLoading(false);
    }
  };

  const handleChartClick = (data: any) => {
    if (data && data.activePayload) {
      const monthClicked = data.activePayload[0].payload.date;
      fetchMapLayerForMonth(monthClicked);
    }
  };

  const [isDownloadingCSV, setIsDownloadingCSV] = useState(false);
  const [isDownloadingGEE, setIsDownloadingGEE] = useState(false);

  const handleDownloadCSV = async () => {
    if (!data || data.length === 0) return;
    setIsDownloadingCSV(true);
    try {
      const response = await fetch('/api/export/csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data })
      });
      
      if (!response.ok) {
        throw new Error('Falha ao exportar CSV');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'serie_historica.csv';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Erro ao baixar CSV: " + err.message);
    } finally {
      setIsDownloadingCSV(false);
    }
  };

  const fetchTimeSeries = async () => {
    setErrorMsg(null);
    if (!selectedBasinGeoJSON) {
      setErrorMsg("Selecione uma bacia primeiro!");
      return;
    }
    
    setLoading(true);
    if (chartRef.current) {
      chartRef.current.scrollIntoView({ behavior: 'smooth' });
    }
    
    try {
      const response = await fetch('/api/timeseries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          geoJson: selectedBasinGeoJSON,
          startDate: dates.start,
          endDate: dates.end
        })
      });
      
      let result;
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.indexOf("application/json") !== -1) {
        result = await response.json();
      } else {
        const text = await response.text();
        throw new Error(`Resposta inválida do servidor (${response.status}): ${text.substring(0, 100)}`);
      }

      console.log('Time series result:', result);
      if (response.ok) {
        if (result.length === 0) {
          setErrorMsg("Nenhum dado encontrado para o período selecionado.");
        } else {
          // Auto-load the map for the month with the highest flood area
          let maxMonth = result[0].date;
          let maxArea = result[0].water_area_km2 || 0;
          for (const item of result) {
            if ((item.water_area_km2 || 0) > maxArea) {
              maxArea = item.water_area_km2;
              maxMonth = item.date;
            }
          }
          fetchMapLayerForMonth(maxMonth);
        }
        setData(result);
      } else {
        setErrorMsg("Erro: " + (result.error || "Falha na requisição"));
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Erro de conexão com o servidor: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div ref={chartRef} className="bg-white p-4 rounded-lg shadow-md mt-4">
      <h3 className="text-lg font-bold mb-4">Série Histórica: Chuva vs Inundação</h3>
      
      {/* Controles de Data */}
      <div className="flex flex-wrap gap-4 mb-4 items-end">
        <div>
          <label className="block text-sm text-gray-600">Data Inicial</label>
          <input type="date" value={dates.start} onChange={e => setDates({...dates, start: e.target.value})} className="border p-2 rounded" />
        </div>
        <div>
          <label className="block text-sm text-gray-600">Data Final</label>
          <input type="date" value={dates.end} onChange={e => setDates({...dates, end: e.target.value})} className="border p-2 rounded" />
        </div>
        <button 
          onClick={fetchTimeSeries}
          disabled={loading || !selectedBasinGeoJSON}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:bg-gray-400 flex items-center gap-2"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {loading ? 'Extraindo do GEE...' : 'Gerar Gráfico'}
        </button>
        
        {data.length > 0 && (
          <button 
            onClick={handleDownloadCSV}
            disabled={isDownloadingCSV}
            className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:bg-gray-400 flex items-center gap-2 ml-auto"
          >
            {isDownloadingCSV ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            {isDownloadingCSV ? 'Baixando...' : 'Baixar Série Temporal (CSV)'}
          </button>
        )}
      </div>

      {errorMsg && (
        <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-md text-red-800 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {errorMsg}
        </div>
      )}

      {/* Gráfico Recharts */}
      {data.length > 0 ? (
        <div className="flex flex-col gap-6">
          <div style={{ width: '100%', height: 400, minHeight: 400 }}>
            <p className="text-sm text-gray-500 mb-2">Clique em um mês no gráfico para visualizar a mancha de inundação no mapa abaixo.</p>
            <ResponsiveContainer width="100%" height="100%" minHeight={400}>
              <ComposedChart onClick={handleChartClick} data={data} margin={{ top: 20, right: 20, bottom: 20, left: 20 }} style={{ cursor: 'pointer' }}>
                <CartesianGrid stroke="#f5f5f5" />
                <XAxis dataKey="date" />
                
                {/* Eixo Y Esquerdo: Área de Água */}
                <YAxis yAxisId="left" label={{ value: 'Área Inundada (km²)', angle: -90, position: 'insideLeft' }} />
                
                {/* Eixo Y Direito: Chuva */}
                <YAxis yAxisId="right" orientation="right" reversed={true} label={{ value: 'Precipitação (mm)', angle: 90, position: 'insideRight' }} />
                
                <Tooltip />
                <Legend />
                
                {/* Plot da Inundação como Área (Cor de água) no eixo Esquerdo */}
                <Area yAxisId="left" type="monotone" dataKey="water_area_km2" name="Área Inundada (km²)" fill="#8884d8" stroke="#8884d8" opacity={0.6} />
                
                {/* Plot da Chuva como Barras (Cor azul escuro) no eixo Direito */}
                <Bar yAxisId="right" dataKey="precip_mm" name="Precipitação (mm)" barSize={20} fill="#413ea0" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Mapa NDWI */}
          <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50">
            <div className="p-4 bg-white border-b border-slate-200 flex justify-between items-center">
              <div className="flex items-center gap-2 text-slate-800 font-medium">
                <MapIcon className="w-5 h-5 text-blue-600" />
                Mancha de Inundação (NDWI) {selectedMonth ? `- ${selectedMonth}` : ''}
              </div>
              <div className="flex items-center gap-4">
                {mapLoading && (
                  <div className="flex items-center gap-2 text-sm text-blue-600">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Gerando mapa...
                  </div>
                )}
                {selectedMonth && !mapLoading && (
                  <button
                    onClick={async () => {
                      setIsDownloadingGEE(true);
                      try {
                        const response = await fetch('/api/export/gee-raster', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            geoJson: selectedBasinGeoJSON,
                            targetMonth: selectedMonth,
                            type: 'ndwi'
                          })
                        });
                        const result = await response.json();
                        if (response.ok && result.downloadUrl) {
                          window.open(result.downloadUrl, '_blank');
                        } else {
                          alert("Erro ao gerar link de download: " + (result.error || "Desconhecido"));
                        }
                      } catch (err: any) {
                        alert("Erro de conexão: " + err.message);
                      } finally {
                        setIsDownloadingGEE(false);
                      }
                    }}
                    disabled={isDownloadingGEE}
                    className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {isDownloadingGEE ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    {isDownloadingGEE ? 'Gerando Link...' : 'Baixar GeoTIFF (GEE)'}
                  </button>
                )}
              </div>
            </div>
            <div className="h-[400px] w-full relative z-0">
              <MapContainer 
                center={[-15, -50]} 
                zoom={4} 
                style={{ height: '100%', width: '100%' }}
              >
                <TileLayer
                  url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                />
                {selectedBasinGeoJSON && (
                  <GeoJSON 
                    data={selectedBasinGeoJSON} 
                    style={{ color: '#64748b', weight: 2, fillOpacity: 0 }} 
                  />
                )}
                {ndwiTileUrl && (
                  <TileLayer
                    url={ndwiTileUrl}
                    opacity={0.7}
                    zIndex={10}
                  />
                )}
                <MapUpdater geojson={selectedBasinGeoJSON} />
              </MapContainer>
            </div>
          </div>
        </div>
      ) : (
        !loading && !errorMsg && <p className="text-gray-500 text-sm mt-4">Nenhum dado para exibir. Clique em "Gerar Gráfico".</p>
      )}
    </div>
  );
};

export default TimeSeriesChart;

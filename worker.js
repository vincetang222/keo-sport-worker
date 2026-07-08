// worker.js — "keo-sport-worker": Worker DUY NHẤT cho toàn bộ dữ liệu thể thao + thời tiết qua
// API-Sports (thể thao) và OpenWeatherMap (thời tiết, mục Du lịch trong nhip-song.html).
//
// KIẾN TRÚC: API MỚI (API-Sports) phủ CÀNG NHIỀU GIẢI LỚN CÀNG TỐT cho Football/Basketball/
// Volleyball. API CŨ (SportScore) từ giờ CHỈ còn phục vụ Tennis. OpenWeatherMap phục vụ riêng
// mục Du lịch — CHỌN ĐÚNG nguồn này vì ToS của họ ghi rõ bằng văn bản "Commercial use is allowed"
// (giấy phép ODbL) — khác hẳn Open-Meteo (đã kiểm tra và loại vì ghi rõ "chỉ phi thương mại",
// không hợp lệ cho keo.social là nền tảng thương mại).
//
// CÁC ROUTE:
//   GET /football/top     → gộp nhiều giải lớn (xem FOOTBALL_LEAGUES bên dưới)
//   GET /basketball/nba   → NBA (hôm qua/hôm nay/ngày mai)
//   GET /volleyball       → cần thêm 1 bước tra cứu — xem ghi chú
//   GET /weather/vn-cities → thời tiết hiện tại 10 điểm đến du lịch phổ biến VN
//
// VỀ QUOTA THỂ THAO: mỗi giải trong FOOTBALL_LEAGUES = 1 lệnh gọi thật riêng (API-Sports không có
// kiểu "gộp nhiều giải trong 1 lần gọi"). Cache được CHỈNH RIÊNG theo số lệnh gọi mỗi route để
// tổng số lệnh gọi/ngày luôn nằm dưới 100 (quota free/ngày/API), có dư khoảng 30-40% phòng hờ:
//   Football: 10 giải × 1 lệnh = 10 lệnh/lần làm mới. Cache 4 tiếng → tối đa 6 lần/ngày → 60 lệnh/ngày.
//   Basketball: 3 ngày × 1 lệnh = 3 lệnh/lần làm mới. Cache 1 tiếng → tối đa 24 lần/ngày → ~72 lệnh/ngày.
//   Volleyball: 1 lệnh/lần làm mới. Cache 30 phút → tối đa 48 lần/ngày → 48 lệnh/ngày.
//
// VỀ QUOTA THỜI TIẾT: OpenWeatherMap free = 1.000.000 lệnh/tháng, 60 lệnh/phút — RẤT dư dả so
// với 10 thành phố × 1 lệnh/lần làm mới. Cache 20 phút → tối đa 72 lần/ngày × 10 = 720 lệnh/ngày
// × 30 ngày ≈ 21.600 lệnh/tháng — chưa tới 3% hạn mức, còn dư rất nhiều nếu muốn thêm thành phố.

// 10 điểm đến du lịch phổ biến VN — toạ độ để gọi OpenWeatherMap theo lat/lon (chính xác hơn gọi
// theo tên thành phố, tránh nhầm giữa các địa danh trùng tên ở nước khác).
const VN_CITIES = [
  { name: 'Hà Nội',      lat: 21.0285, lon: 105.8542 },
  { name: 'TP. Hồ Chí Minh', lat: 10.8231, lon: 106.6297 },
  { name: 'Đà Nẵng',     lat: 16.0544, lon: 108.2022 },
  { name: 'Hội An',      lat: 15.8801, lon: 108.3380 },
  { name: 'Đà Lạt',      lat: 11.9404, lon: 108.4583 },
  { name: 'Nha Trang',   lat: 12.2388, lon: 109.1967 },
  { name: 'Phú Quốc',    lat: 10.2270, lon: 103.9631 },
  { name: 'Sa Pa',       lat: 22.3380, lon: 103.8442 },
  { name: 'Huế',         lat: 16.4637, lon: 107.5909 },
  { name: 'Hạ Long',     lat: 20.9600, lon: 107.0450 },
];

// Mã giải Football ĐÃ XÁC NHẬN — đối chiếu trực tiếp từ dashboard.api-football.com/soccer/ids
// (ảnh chụp màn hình thật do người dùng cung cấp 07/2026), dùng đúng cột "ID (V3)" khớp với
// endpoint v3.football.api-sports.io đang gọi trong code này (KHÔNG dùng cột "ID (V2)" — 2 hệ mã
// khác nhau, dễ nhầm nếu không để ý). Season KHÔNG phải lúc nào cũng "2026" — vài giải không tổ
// chức hàng năm nên mùa "Current: True" mới nhất có thể là năm khác, đã ghi rõ đúng theo ảnh.
const FOOTBALL_LEAGUES = [
  { id: 1,   name: 'FIFA World Cup',           season: 2026 },
  { id: 2,   name: 'UEFA Champions League',    season: 2026 },
  { id: 3,   name: 'UEFA Europa League',       season: 2026 },
  { id: 4,   name: 'UEFA European Championship', season: 2024 }, // Euro 2024 là mùa gần nhất — Euro không tổ chức hàng năm, kế tiếp là 2028
  { id: 5,   name: 'UEFA Nations League',      season: 2026 }, // mùa 2026 bắt đầu 24/9/2026 — trước đó (T7/2026 hiện tại) đang giữa 2 mùa, không có trận
  { id: 15,  name: 'FIFA Club World Cup',      season: 2025 }, // thể thức mới 4 năm/lần — mùa 2025 (đã đấu xong T7/2025) là mùa gần nhất
  { id: 22,  name: 'CONCACAF Gold Cup',        season: 2025 }, // 2 năm/lần — mùa 2025 (đã đấu xong T7/2025) là mùa gần nhất
  { id: 39,  name: 'English Premier League',   season: 2026 },
  { id: 140, name: 'Spanish La Liga',          season: 2026 },
  { id: 532, name: 'AFC U23 Asian Cup',        season: 2025 }, // ĐANG DIỄN RA THẬT (06-24/1/2026) — xem ghi chú trong phản hồi về việc đây là bản U23, không phải đội tuyển chính
];


// GHI CHÚ VOLLEYBALL: cần đúng mã giải liên quan VN (VD AVC Cup) — cũng phải tra sau khi có key
// thật, gọi /leagues?search=... (không đoán mù theo đúng nguyên tắc dự án này).
const VOLLEYBALL_LEAGUE_ID = null; // ← điền sau khi tra được mã giải đúng
const VOLLEYBALL_SEASON = 2026;

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*', // đổi thành 'https://keo.social' nếu muốn khoá chặt hơn
      'Access-Control-Allow-Methods': 'GET',
      'Content-Type': 'application/json; charset=utf-8',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    const cache = caches.default;
    const cacheKey = new Request(request.url, request);
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const { pathname } = new URL(request.url);
    let result, cacheSeconds;
    try {
      if (pathname === '/football/top') { result = await getFootballTop(env); cacheSeconds = 14400; } // 4 tiếng — 10 giải × 1 lệnh, cần cache dài hơn để an toàn quota
      else if (pathname === '/basketball/nba') { result = await getNBA(env); cacheSeconds = 3600; } // 1 tiếng
      else if (pathname === '/volleyball') { result = await getVolleyball(env); cacheSeconds = 1800; } // 30 phút
      else if (pathname === '/weather/vn-cities') { result = await getVNWeather(env); cacheSeconds = 1200; } // 20 phút
      else return new Response(JSON.stringify({ error: 'Route không tồn tại. Dùng /football/top, /basketball/nba, /volleyball, hoặc /weather/vn-cities' }), { status: 404, headers: corsHeaders });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Worker lỗi: ' + err.message }), { status: 500, headers: corsHeaders });
    }

    const response = new Response(JSON.stringify(result), { headers: corsHeaders });
    response.headers.set('Cache-Control', `public, max-age=${cacheSeconds}`);
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  }
};

// ─── FOOTBALL: gộp nhiều giải lớn (xem FOOTBALL_LEAGUES) — mỗi giải 1 lệnh gọi riêng, chạy song
// song (Promise.all) để nhanh, rồi gộp lại thành 1 mảng trận đấu duy nhất, có gắn tên giải ──────
// CÓ THÊM _debug: khi count=0 bất thường trên diện rộng (VD cả 10 giải cùng 0 trận), cần biết
// CHÍNH XÁC từng giải trả về gì (mã lỗi HTTP, thông báo lỗi từ chính API-Sports) thay vì đoán mò —
// _debug giữ lại thông tin này, không ảnh hưởng gì tới cách nhip-song.html dùng field `matches`.
async function getFootballTop(env) {
  const perLeague = await Promise.all(FOOTBALL_LEAGUES.map(async lg => {
    try {
      const r = await fetch(`https://v3.football.api-sports.io/fixtures?league=${lg.id}&season=${lg.season}`, {
        headers: { 'x-apisports-key': env.API_FOOTBALL_KEY }
      });
      const raw = await r.json(); // đọc cả khi HTTP lỗi để lấy thông tin debug từ body
      const debugInfo = {
        league: lg.name, id: lg.id, season: lg.season,
        http_status: r.status,
        api_results: raw?.results ?? null, // API-Sports luôn trả "results": số lượng bản ghi thật tìm được
        api_errors: raw?.errors ?? null,   // API-Sports trả lỗi validation/quyền hạn ở đây dù HTTP vẫn 200
      };
      if (!r.ok) return { matches: [], debugInfo };
      const matches = (raw.response || []).map(m => ({
        id: m.fixture?.id,
        time: m.fixture?.date,
        status: m.fixture?.status?.short,
        status_text: m.fixture?.status?.long,
        round: m.league?.round,
        competition: lg.name,
        home: m.teams?.home?.name,
        away: m.teams?.away?.name,
        home_logo: m.teams?.home?.logo,
        away_logo: m.teams?.away?.logo,
        home_score: m.goals?.home,
        away_score: m.goals?.away,
        venue: m.fixture?.venue?.name,
      }));
      return { matches, debugInfo };
    } catch (err) {
      return { matches: [], debugInfo: { league: lg.name, id: lg.id, season: lg.season, fetch_error: err.message } };
    }
  }));
  const matches = perLeague.flatMap(r => r.matches);
  const _debug = perLeague.map(r => r.debugInfo);
  return { competitions: FOOTBALL_LEAGUES.map(l => l.name), updated: new Date().toISOString(), count: matches.length, matches, _debug };
}

// ─── BASKETBALL: NBA (lọc theo ngày — /games cần tham số date, đã xác nhận qua ví dụ chính thức) ──
async function getNBA(env) {
  const fmt = d => d.toISOString().slice(0, 10);
  const today = new Date();
  const dates = [-1, 0, 1].map(off => {
    const d = new Date(today); d.setDate(d.getDate() + off); return fmt(d);
  }); // hôm qua, hôm nay, ngày mai — đủ cho "trực tiếp & sắp diễn ra" + "kết quả gần đây"

  const perDate = await Promise.all(dates.map(async date => {
    const r = await fetch(`https://v2.nba.api-sports.io/games?date=${date}`, {
      headers: { 'x-apisports-key': env.API_FOOTBALL_KEY }
    });
    if (!r.ok) return [];
    const raw = await r.json();
    return raw.response || [];
  }));

  const matches = perDate.flat().map(m => ({
    id: m.id,
    time: m.date?.start,
    status: m.status?.short,
    status_text: m.status?.long,
    competition: 'NBA',
    home: m.teams?.home?.name,
    away: m.teams?.visitors?.name, // API-Sports NBA dùng "visitors" thay vì "away" — khác Football, giữ đúng tên field gốc
    home_logo: m.teams?.home?.logo,
    away_logo: m.teams?.visitors?.logo,
    home_score: m.scores?.home?.points,
    away_score: m.scores?.visitors?.points,
  }));
  return { competition: 'NBA', updated: new Date().toISOString(), count: matches.length, matches };
}

// ─── VOLLEYBALL: cần VOLLEYBALL_LEAGUE_ID điền tay sau khi tra cứu — xem ghi chú đầu file ──
async function getVolleyball(env) {
  if (!VOLLEYBALL_LEAGUE_ID) {
    return { competition: 'Bóng chuyền', updated: new Date().toISOString(), count: 0, matches: [],
      note: 'Chưa điền VOLLEYBALL_LEAGUE_ID — cần tra cứu mã giải đúng trước (xem ghi chú đầu file worker.js)' };
  }
  const r = await fetch(`https://v1.volleyball.api-sports.io/games?league=${VOLLEYBALL_LEAGUE_ID}&season=${VOLLEYBALL_SEASON}`, {
    headers: { 'x-apisports-key': env.API_FOOTBALL_KEY }
  });
  if (!r.ok) throw new Error(`Volleyball API lỗi HTTP ${r.status}`);
  const raw = await r.json();
  const matches = (raw.response || []).map(m => ({
    id: m.id,
    time: m.date,
    status: m.status?.short,
    status_text: m.status?.long,
    round: m.week,
    competition: 'Bóng chuyền',
    home: m.teams?.home?.name,
    away: m.teams?.away?.name,
    home_logo: m.teams?.home?.logo,
    away_logo: m.teams?.away?.logo,
    home_score: m.scores?.home,
    away_score: m.scores?.away,
  }));
  return { competition: 'Bóng chuyền', updated: new Date().toISOString(), count: matches.length, matches };
}

// ─── THỜI TIẾT: 10 điểm đến du lịch VN, gọi song song (Promise.all) rồi gộp lại 1 mảng ──
// Dùng OpenWeatherMap "classic" Current Weather API (/data/2.5/weather) — KHÔNG dùng "One Call
// 3.0" (endpoint /data/3.0/onecall) vì bản đó bắt nhập thẻ tín dụng ngay cả ở gói free, dễ vô
// tình bị tính phí nếu vượt hạn mức. Bản classic dùng ở đây: free thật, không cần thẻ, có giấy
// phép thương mại rõ ràng (ODbL).
async function getVNWeather(env) {
  const results = await Promise.all(VN_CITIES.map(async city => {
    try {
      const url = `https://api.openweathermap.org/data/2.5/weather?lat=${city.lat}&lon=${city.lon}&units=metric&lang=vi&appid=${env.OPENWEATHER_KEY}`;
      const r = await fetch(url);
      if (!r.ok) return { name: city.name, error: `HTTP ${r.status}` };
      const raw = await r.json();
      return {
        name: city.name,
        temp: raw.main?.temp!=null ? Math.round(raw.main.temp) : null,
        feels_like: raw.main?.feels_like!=null ? Math.round(raw.main.feels_like) : null,
        humidity: raw.main?.humidity,
        wind_speed: raw.wind?.speed, // m/s
        condition: raw.weather?.[0]?.description, // đã lang=vi nên trả tiếng Việt
        icon: raw.weather?.[0]?.icon, // VD "10d" — ghép với https://openweathermap.org/img/wn/{icon}@2x.png ở phía client
        sunrise: raw.sys?.sunrise, // unix timestamp UTC
        sunset: raw.sys?.sunset,
      };
    } catch (err) {
      return { name: city.name, error: err.message };
    }
  }));
  return { updated: new Date().toISOString(), attribution: 'Weather data by OpenWeather (openweathermap.org)', cities: results };
}

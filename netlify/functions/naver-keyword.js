const https = require('https');
const crypto = require('crypto');

function makeSignature(secretKey, timestamp, method, path) {
  // 공식 Python 샘플과 동일: secret_key.encode("utf-8"), message.encode("utf-8")
  const message = `${timestamp}.${method}.${path}`;
  const hmac = crypto.createHmac('sha256', secretKey);
  hmac.update(message);
  return hmac.digest('base64');
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const { keyword, apiKey, secretKey, customerId } = JSON.parse(event.body || '{}');
    if (!keyword || !apiKey || !secretKey || !customerId)
      return { statusCode: 400, headers, body: JSON.stringify({ error: '파라미터 누락' }) };

    const timestamp = Date.now().toString();
    const signature = makeSignature(secretKey, timestamp, 'GET', '/keywordstool');
    const fullPath = `/keywordstool?hintKeywords=${encodeURIComponent(keyword)}&showDetail=1`;

    const result = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.searchad.naver.com',
        path: fullPath,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Timestamp': timestamp,
          'X-API-KEY': apiKey,
          'X-Customer': String(customerId),
          'X-Signature': signature,
        },
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch(e) { resolve({ status: res.statusCode, raw: data }); }
        });
      });
      req.on('error', reject);
      req.end();
    });

    if (result.status !== 200) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          keyword, monthlyPc: '0', monthlyMobile: '0', monthlyTotal: '0',
          competition: '—', competitionScore: 55, avgCpc: '—',
          trendData: null, relatedKeywords: [],
          _debug: { status: result.status, body: result.body, raw: result.raw }
        })
      };
    }

    const items = (result.body && result.body.keywordList) || [];
    const main = items.find(k => k.relKeyword === keyword) || items[0] || {};
    const rels = items.filter(k => k.relKeyword !== keyword);

    const toNum = v => {
      if (!v) return 0;
      const n = parseInt(String(v).replace(/[<,\s]/g, ''));
      return isNaN(n) ? 10 : n;
    };

    const pc = toNum(main.monthlyPcQcCnt);
    const mob = toNum(main.monthlyMobileQcCnt);
    const ci = main.compIdx || '';

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        keyword,
        monthlyPc: pc.toLocaleString('ko-KR'),
        monthlyMobile: mob.toLocaleString('ko-KR'),
        monthlyTotal: (pc + mob).toLocaleString('ko-KR'),
        competition: ci || '—',
        competitionScore: ci === '낮음' ? 25 : ci === '높음' ? 85 : 55,
        avgCpc: main.plAvgDepth ? Math.round(Number(main.plAvgDepth)).toLocaleString('ko-KR') + '원' : '—',
        trendData: null,
        relatedKeywords: rels.map(k => ({
          word: k.relKeyword,
          vol: (toNum(k.monthlyPcQcCnt) + toNum(k.monthlyMobileQcCnt)).toLocaleString('ko-KR'),
          comp: k.compIdx || '—',
          pcVol: toNum(k.monthlyPcQcCnt),
          mobileVol: toNum(k.monthlyMobileQcCnt),
        })),
        _debug: { status: result.status, itemCount: items.length }
      })
    };
  } catch(err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

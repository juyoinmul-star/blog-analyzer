const https = require('https');
const crypto = require('crypto');

function makeSignature(secretKey, timestamp, method, path) {
  const hmac = crypto.createHmac('sha256', secretKey);
  hmac.update(timestamp + '.' + method + '.' + path);
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
    const method = 'GET';
    const path = '/keywordstool';
    const signature = makeSignature(secretKey, timestamp, method, path);

    const query = `hintKeywords=${encodeURIComponent(keyword)}&showDetail=1&includeHintKeywords=1`;
    const fullPath = `${path}?${query}`;

    const result = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.naver.com',
        path: fullPath,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Timestamp': timestamp,
          'X-API-KEY': apiKey,
          'X-Customer': String(customerId),
          'X-Signature': signature,
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch(e) { resolve({ status: res.statusCode, body: data }); }
        });
      });
      req.on('error', reject);
      req.end();
    });

    // 네이버 API 오류 응답 체크
    if (result.status !== 200 || result.body.title) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ error: `네이버 API 오류 (${result.status})`, debug: result.body })
      };
    }

    const items = result.body.keywordList || [];
    const main = items.find(k => k.relKeyword === keyword) || items[0] || {};
    const rels = items.filter(k => k.relKeyword !== keyword);

    const toNum = v => {
      if (!v) return 0;
      const s = String(v).replace(/[<,\s]/g, '');
      const n = parseInt(s);
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
        relatedKeywords: rels.map(k => {
          const kpc = toNum(k.monthlyPcQcCnt);
          const kmob = toNum(k.monthlyMobileQcCnt);
          return {
            word: k.relKeyword,
            vol: (kpc + kmob).toLocaleString('ko-KR'),
            comp: k.compIdx || '—',
            pcVol: kpc,
            mobileVol: kmob,
          };
        }),
      })
    };

  } catch(err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

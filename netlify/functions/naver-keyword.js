const https = require('https');
const crypto = require('crypto');

function makeSignature(secretKey, timestamp, method, path) {
  const hmac = crypto.createHmac('sha256', secretKey);
  hmac.update(timestamp + '.' + method + '.' + path);
  return hmac.digest('base64');
}

function doRequest(hostname, path, apiKey, secretKey, customerId) {
  const timestamp = Date.now().toString();
  const signature = makeSignature(secretKey, timestamp, 'GET', '/keywordstool');
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname,
      path,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Timestamp': timestamp,
        'X-API-KEY': apiKey,
        'X-Customer': String(customerId),
        'X-Signature': signature,
      },
    }, (res) => {
      // 308/301/302 리다이렉트 처리
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        const loc = res.headers.location;
        const url = new URL(loc.startsWith('http') ? loc : `https://${hostname}${loc}`);
        return doRequest(url.hostname, url.pathname + url.search, apiKey, secretKey, customerId)
          .then(resolve).catch(reject);
      }
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

    const path = `/keywordstool?hintKeywords=${encodeURIComponent(keyword)}&showDetail=1`;
    const result = await doRequest('api.naver.com', path, apiKey, secretKey, customerId);

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
        _debug: { status: result.status, itemCount: items.length, raw: result.raw }
      })
    };
  } catch(err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

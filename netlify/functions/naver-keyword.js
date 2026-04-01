const https = require('https');
const crypto = require('crypto');

function makeSignature(timestamp, method, path, secretKey) {
  const message = `${timestamp}.${method}.${path}`;
  return crypto.createHmac('sha256', secretKey).update(message).digest('base64');
}

function naverRequest(fullPath, apiKey, secretKey, customerId) {
  return new Promise((resolve, reject) => {
    const timestamp = Date.now().toString();
    // 서명은 쿼리스트링 제외한 path만
    const pathOnly = fullPath.split('?')[0];
    const signature = makeSignature(timestamp, 'GET', pathOnly, secretKey);
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
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve({ _raw: data, _status: res.statusCode }); }
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

    const encoded = encodeURIComponent(keyword);
    const kwData = await naverRequest(
      `/keywordstool?hintKeywords=${encoded}&showDetail=1&includeHintKeywords=1`,
      apiKey, secretKey, customerId
    );

    // 오류 체크
    if (kwData.title || kwData._status === 403 || kwData._status === 401) {
      return { statusCode: 200, headers, body: JSON.stringify({ error: 'API 인증 실패', debug: kwData }) };
    }

    const items = kwData.keywordList || [];
    const mainKw = items.find(k => k.relKeyword === keyword) || items[0] || {};
    const relKws = items.filter(k => k.relKeyword !== keyword);

    const pc = v => { if(!v) return 0; const n=parseInt(String(v).replace(/[<,\s]/g,'')); return isNaN(n)?0:n; };

    const pcS = pc(mainKw.monthlyPcQcCnt);
    const mobS = pc(mainKw.monthlyMobileQcCnt);
    const ci = mainKw.compIdx || '';
    const ciMap = { '낮음':'낮음', '보통':'보통', '높음':'높음', low:'낮음', medium:'보통', high:'높음' };

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        keyword,
        monthlyPc: pcS.toLocaleString('ko-KR'),
        monthlyMobile: mobS.toLocaleString('ko-KR'),
        monthlyTotal: (pcS+mobS).toLocaleString('ko-KR'),
        competition: ciMap[ci] || ci || '—',
        competitionScore: ci==='낮음'||ci==='low'?25 : ci==='높음'||ci==='high'?85 : 55,
        avgCpc: mainKw.plAvgDepth ? Math.round(Number(mainKw.plAvgDepth)).toLocaleString('ko-KR')+'원' : '—',
        trendData: null,
        relatedKeywords: relKws.map(k => {
          const kpc=pc(k.monthlyPcQcCnt), kmob=pc(k.monthlyMobileQcCnt);
          const kci=k.compIdx||'';
          return { word:k.relKeyword, vol:(kpc+kmob).toLocaleString('ko-KR'), comp:ciMap[kci]||kci||'—', pcVol:kpc, mobileVol:kmob };
        }),
      })
    };
  } catch(err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

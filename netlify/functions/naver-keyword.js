const https = require('https');
const crypto = require('crypto');

// 네이버 검색광고 API 서명 생성
function makeSignature(timestamp, method, path, secretKey) {
  const message = `${timestamp}.${method}.${path}`;
  return crypto.createHmac('sha256', secretKey).update(message).digest('base64');
}

function naverRequest(path, apiKey, secretKey, customerId) {
  return new Promise((resolve, reject) => {
    const timestamp = Date.now().toString();
    const signature = makeSignature(timestamp, 'GET', path, secretKey);
    const options = {
      hostname: 'api.naver.com',
      path,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Timestamp': timestamp,
        'X-API-KEY': apiKey,
        'X-Customer': customerId,
        'X-Signature': signature,
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve({ error: data }); }
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
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const { keyword, apiKey, secretKey, customerId } = JSON.parse(event.body || '{}');
    if (!keyword || !apiKey || !secretKey || !customerId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: '필수 파라미터 누락' }) };
    }

    const encoded = encodeURIComponent(keyword);

    // 1. 키워드 기본 정보 (월 검색량, 경쟁도, CPC 등)
    const kwPath = `/keywordstool?hintKeywords=${encoded}&showDetail=1`;
    const kwData = await naverRequest(kwPath, apiKey, secretKey, customerId);

    // 2. 월별 트렌드 (최근 12개월)
    const trendPath = `/keywordstool?hintKeywords=${encoded}&includeHintKeywords=1`;
    const trendData = await naverRequest(trendPath, apiKey, secretKey, customerId);

    // 결과 가공
    const items = kwData.keywordList || [];
    const mainKw = items.find(k => k.relKeyword === keyword) || items[0] || {};
    const relKws = items.filter(k => k.relKeyword !== keyword).slice(0, 20);

    // 경쟁도 계산
    const pcSearch = parseInt(mainKw.monthlyPcQcCnt) || 0;
    const mobileSearch = parseInt(mainKw.monthlyMobileQcCnt) || 0;
    const totalSearch = pcSearch + mobileSearch;
    const competition = mainKw.compIdx || 'medium';
    const compMap = { low: '낮음', medium: '보통', high: '높음' };

    // 포화도 계산 (검색량 대비 경쟁 지수)
    const compScore = competition === 'low' ? 30 : competition === 'medium' ? 65 : 90;

    // 트렌드 데이터 (12개월)
    const trendItems = trendData.keywordList || [];
    const mainTrend = trendItems.find(k => k.relKeyword === keyword) || {};
    const monthlyTrends = mainTrend.monthlyQcCnts || [];
    const trendArr = monthlyTrends.slice(-12).map(m =>
      (parseInt(m.pcQcCnt) || 0) + (parseInt(m.mobileQcCnt) || 0)
    );

    const result = {
      keyword,
      monthlyPc: pcSearch.toLocaleString(),
      monthlyMobile: mobileSearch.toLocaleString(),
      monthlyTotal: totalSearch.toLocaleString(),
      competition: compMap[competition] || '보통',
      competitionScore: compScore,
      avgCpc: mainKw.plAvgDepth ? Math.round(mainKw.plAvgDepth).toLocaleString() + '원' : '—',
      trendData: trendArr.length ? trendArr : null,
      relatedKeywords: relKws.map(k => ({
        word: k.relKeyword,
        vol: ((parseInt(k.monthlyPcQcCnt) || 0) + (parseInt(k.monthlyMobileQcCnt) || 0)).toLocaleString(),
        comp: compMap[k.compIdx] || '보통',
        pcVol: parseInt(k.monthlyPcQcCnt) || 0,
        mobileVol: parseInt(k.monthlyMobileQcCnt) || 0,
      })),
      raw: { mainKw, relCount: relKws.length },
    };

    return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};

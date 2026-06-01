exports.handler = async function(event) {

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let url;
  try { url = JSON.parse(event.body).url; }
  catch(e) { return { statusCode: 400, body: 'Bad Request' }; }

  if (!url || !url.startsWith('http')) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: '유효하지 않은 URL' })
    };
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!res.ok) throw new Error('HTTP ' + res.status);
    const html = await res.text();

    // 제목 추출
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/\s+/g,' ').trim() : '';

    // 본문 핵심 영역 추출 (뉴스 기사 본문 태그 우선)
    let bodyText = '';

    // 1. article 태그
    const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    if (articleMatch) bodyText = articleMatch[1];

    // 2. 네이버 뉴스 본문
    if (!bodyText) {
      const naverMatch = html.match(/id="dic_area"[^>]*>([\s\S]*?)<\/div>/i) ||
                         html.match(/class="go_trans _article_content"[^>]*>([\s\S]*?)<\/div>/i);
      if (naverMatch) bodyText = naverMatch[1];
    }

    // 3. 다음 뉴스 본문
    if (!bodyText) {
      const daumMatch = html.match(/class="article_view[^"]*"[^>]*>([\s\S]*?)<\/section>/i);
      if (daumMatch) bodyText = daumMatch[1];
    }

    // 4. 일반 뉴스 본문 (p 태그 집중 추출)
    if (!bodyText) {
      const pTags = html.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || [];
      bodyText = pTags
        .map(p => p.replace(/<[^>]+>/g,' ').trim())
        .filter(t => t.length > 30 && !t.includes('Copyright') && !t.includes('저작권') && !t.includes('무단전재'))
        .slice(0, 30)
        .join('\n');
    }

    // 5. 폴백: 전체 HTML에서 의미있는 텍스트만 추출
    if (!bodyText || bodyText.length < 100) {
      bodyText = html;
    }

    // HTML 클렌징
    const clean = (str) => str
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<aside[\s\S]*?<\/aside>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
      .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
      .replace(/\s{2,}/g, ' ')
      .trim();

    const text = (title ? title + '\n\n' : '') + clean(bodyText).slice(0, 5000);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: JSON.stringify({ text, title })
    };

  } catch(e) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ text: '', error: e.message })
    };
  }
};

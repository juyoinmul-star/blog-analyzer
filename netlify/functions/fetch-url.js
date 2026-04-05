// netlify/functions/fetch-url.js
// URL 내용을 서버사이드에서 가져와서 텍스트 추출

exports.handler = async function(event) {
  if(event.httpMethod !== 'POST') return {statusCode:405,body:'Method Not Allowed'};
  
  let url;
  try { url = JSON.parse(event.body).url; } 
  catch(e) { return {statusCode:400,body:'Bad Request'}; }
  
  if(!url || !url.startsWith('http')) {
    return {statusCode:400,body:JSON.stringify({error:'유효하지 않은 URL'})};
  }
  
  try {
    const res = await fetch(url, {
      headers:{
        'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept':'text/html,application/xhtml+xml',
        'Accept-Language':'ko-KR,ko;q=0.9'
      },
      signal: AbortSignal.timeout(8000)
    });
    
    if(!res.ok) throw new Error('HTTP '+res.status);
    
    const html = await res.text();
    
    // 간단한 텍스트 추출 (태그 제거)
    let text = html
      .replace(/<script[\s\S]*?<\/script>/gi,'')
      .replace(/<style[\s\S]*?<\/style>/gi,'')
      .replace(/<[^>]+>/g,' ')
      .replace(/&nbsp;/g,' ')
      .replace(/&lt;/g,'<')
      .replace(/&gt;/g,'>')
      .replace(/&amp;/g,'&')
      .replace(/\s{2,}/g,' ')
      .trim()
      .slice(0, 5000);
    
    return {
      statusCode:200,
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({text})
    };
  } catch(e) {
    return {
      statusCode:200,
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({text:'', error: e.message})
    };
  }
};
